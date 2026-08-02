from langchain_core.messages import HumanMessage, SystemMessage
from ..model_factory import get_model
from .state import CodeReviewState, get_input_by_version, Finding, Input
import json
from ..schemas import invoke_with_retry_llm
import logging
from typing import List
from dataclasses import dataclass

@dataclass
class MergedWindow:
    start: int
    end: int
    findings: List[Finding]

logger = logging.getLogger(__name__)

SEVERITY_RANK = {"critical": 4, "high": 3, "medium": 2, "low": 1}

OUTPUT_DIFF_PROMPT = """You are a code diff generator. Your job is to produce a clean unified diff based on findings from a code review.

You are NOT given the full file — only small numbered code windows around each flagged line. Windows may be non-contiguous; do not assume they connect to each other.

## Flagged Locations
{windowed_findings}

## Input Format
Each code window line is formatted as `N: <code>`, where N is a line number
in the original file, provided only so you can anchor your edits. The
"N: " prefix is metadata, NOT part of the file's actual content — never
copy it into a diff's added or removed lines. Every "-" line in your
diff must be an exact verbatim copy of the original code (with the
"N: " prefix stripped), including whitespace and formatting.

## Your Task
Generate a unified diff in standard format that applies the fixes described above.

## Reconciling Multiple Findings
- If multiple issues are flagged on the same line, produce a single combined edit for that line addressing all of them together, rather than separate conflicting edits.
- Findings anchored at different lines may still target the same function or symbol (e.g. a docstring fix at one line, a validation fix in the function body at another). Group these together and produce ONE final, internally consistent version of that symbol — apply every stated change (signature, defaults, validation logic, docstrings, type hints) without dropping any part of any Fix snippet during merging.
- If two Fix snippets contradict each other (e.g. one implies the function returns `None` on missing/invalid input, another makes it raise an exception instead), resolve the contradiction by prioritizing the higher-severity fix ([high] > [medium] > [low]), and adjust the text of the lower-priority fix (e.g. reword a docstring) so it accurately describes the resulting behavior rather than copying it verbatim.

## Keeping Comments and Docstrings Accurate
- If a fix changes what a line of code does, check whether an adjacent comment describes the pre-fix behavior (e.g. "deliberately unsafe", "still tainted"). If so, update or remove that comment so it reflects the fixed code — never leave a comment asserting a vulnerability or behavior that the fix just resolved.
- Do not describe a function's output as "sanitized," "cleaned," "safe," or similar unless the Fix text for that specific function explicitly establishes that. If a called function's behavior isn't confirmed safe by the given findings, describe what it does mechanically (e.g. "retrieves the user query") rather than asserting an unverified security property.

## Rules
- Base every change strictly on the "Fix" text given for that line — do not invent changes beyond what's stated.
- Make the smallest possible edit that resolves the flagged issue(s). Do not add docstrings, type hints, comments, helper functions, or renames unless a Fix explicitly calls for it.
- Do not restructure, reformat, or "improve" code outside of what the Fixes state, even if it seems beneficial.
- If a Fix implies a function or symbol used in this file was renamed elsewhere (e.g. a called function's name no longer matches what a finding elsewhere establishes), do not silently rename the call site unless a Fix for this file explicitly says so — flag the mismatch by leaving a `# TODO:` comment instead of guessing.
- Use the line numbers shown (prefixed on each code line) to anchor your edits precisely — do not guess line numbers, and do not include the prefixes themselves in the diff content.
- Follow standard unified diff format exactly (--- a/{file_path}, +++ b/{file_path}, @@ ... @@).
- Do not modify or reference any code outside the shown windows.
- If no flagged locations are given, return an empty string.
"""


def filter_findings(findings: list[Finding]) -> dict[tuple, Finding]:
    """Filter the findings based on the severity level.
    Give higher priority to the findings given by the agent having higher severity."""
    filtered_findings: dict[tuple, Finding] = {}
    for finding in findings:
        key = (finding.get('category', "Unknown Category"), finding.get('line_number', 0))
        
        if key not in filtered_findings.keys():
            filtered_findings[key] = finding
        else:
            if SEVERITY_RANK.get(filtered_findings[key]['severity'], 0) < SEVERITY_RANK.get(finding['severity'], 0):
                filtered_findings[key] = finding
    
    return filtered_findings


def group_by_line(filtered_findings: dict[tuple, Finding]) -> dict[int, list[Finding]]:
    """Group findings by line_number so multiple categories flagging the 
    same line get merged into a single window block instead of seperate ones."""
    grouped: dict[int, list[Finding]] = {}
    for (category, line_number), finding in filtered_findings.items():
        if not finding.get('fix_snippet'):
            continue    # skips entirely as nothing to diff
        grouped.setdefault(line_number, []).append(finding)
    return grouped


def concatenated_findings(grouped_findings: dict[int, list[Finding]], file_length: int, padding: int = 10) -> list[MergedWindow]:
    """Converts grouped findings into padded windows and merge overlapping/touching
    windows. This is used to prevent multiple windoes of the same overlapping code in the window_fn 
    thus saving the size of the wqindowed_findings by not having repeated code blocks and thereby saving tokens.
    """
    concatenated_findings: List[MergedWindow] = []

    if not grouped_findings:
        return []

    for line_number, findings in grouped_findings.items():
        start = max(0, line_number - padding)
        end = min(file_length, line_number + padding)
        concatenated_findings.append(
            MergedWindow(
                start=start,
                end=end,
                findings=list(findings)
            )
        )

    concatenated_findings.sort(key=lambda conc: conc.start)

    merged: List[MergedWindow] = []

    # Initializing the sweep 
    current = concatenated_findings[0]

    for conc_findings in concatenated_findings[1:]:
        if conc_findings.start <= current.end:
            current.end = max(current.end, conc_findings.end)
            current.findings.extend(conc_findings.findings)
        else:
            merged.append(current)
            current = conc_findings

    # Making sure the final accumulator also get's appended
    merged.append(current)

    return merged
        
    
def window_fn(grouped_findings: dict[int, list[Finding]], inputs: list[Input]) -> str:
    """Build a token-cheap, line-numbered code window per flagged line, with
    all findings on that line merged into one block for the diff-generation LLM.
    """

    window_docstr = """- ### **Code Window [{start_line} : {end_line}]:**
{code_window}
- **Issues Flagged:**
{issues_block}
"""

    finding_docstr = """Line Number: {line_number}
- [{severity}] {description}
- Suggestion: {suggestion}
- Fix: {fix_snippet}"""

    old_input = get_input_by_version(inputs, 'old')
    new_input = get_input_by_version(inputs, 'new')
    input_old = old_input.get('content') if old_input else None
    input_new = new_input.get('content') if new_input else None

    if input_new is None and input_old is None:
        code = []
    elif input_new is not None:
        code = input_new.splitlines()
    else:
        code = input_old.splitlines()

    merged_findings = concatenated_findings(grouped_findings, len(code))

    list_window = []

    for window in merged_findings:
        code_window = code[window.start:window.end]

        numbered_window = [
            f"{window.start + i + 1}: {line}"
            for i, line in enumerate(code_window)
        ]

        issues_block = "\n".join(
            finding_docstr.format(
                severity=f.get("severity"),
                description=f.get("description"),
                suggestion=f.get("suggestion"),
                fix_snippet=f.get("fix_snippet"),
                line_number=f.get('line_number')
            )
            for f in window.findings
        )

        list_window.append(
            window_docstr.format(
                code_window="\n".join(numbered_window),
                issues_block=issues_block,
                start_line = window.start + 1,
                end_line = window.end
            )
        )

    return "\n\n".join(list_window)
    
            
def markdown_findings(findings: list[Finding]) -> str:
    if not findings:
        return "_No findings reported._"

    findings_sorted = sorted(findings, key=lambda finding: SEVERITY_RANK.get(finding.get('severity')), reverse=True)

    docstr = """### {severity} — {description}
- **Agent:** {agent}
- **File:** {filepath}
- **Line:** {line_number}
- **Suggestion:** {suggestion}
- **Fix:** {fix_snippet}
"""

    list_docs = []
    for finding in findings_sorted:
        list_docs.append(
            docstr.format(
                agent=finding.get('agent'),
                filepath=finding.get('file_path'),
                line_number=finding.get('line_number'),
                severity=finding.get('severity'),
                description=finding.get('description'),
                fix_snippet=finding.get('fix_snippet') if finding.get('fix_snippet') else "No automated fix available, manual review needed",
                suggestion=finding.get('suggestion'),
            )
        )

    return "\n\n".join(list_docs)


output_diff_llm = get_model(role="specialist")

async def output_formatter(state: CodeReviewState):

    findings = state['final_findings'] or state['findings'] or []

    # Defaults so a partial failure still returns something coherent
    output_json = "Error occurred while generating JSON output"
    output_diff = "Error occurred while generating diff"
    output_markdown = "Error occurred while generating markdown report"

    try:
        filtered_findings = filter_findings(findings=findings)
        grouped_findings_by_line = group_by_line(filtered_findings=filtered_findings)
        windowed_findings = window_fn(grouped_findings=grouped_findings_by_line, inputs=state['input'])
        file_path = state['diff_view'][0]['file'] if state['diff_view'] else 'unknown'

        prompt_diff = OUTPUT_DIFF_PROMPT.format(
            windowed_findings=windowed_findings,
            file_path=file_path
        )

        # NOTE: `await X.method()` != `X.method()` then `.attr` before awaiting.
        # `await invoke_with_retry_llm(...).content` parses as `await (invoke_with_retry_llm(...).content)` —
        # `.content` gets accessed on the *coroutine object* itself (never awaited yet), which has no such
        # attribute. Must resolve the await FIRST, then access `.content` on the actual returned object.

        output_diff = (await invoke_with_retry_llm(
            llm=output_diff_llm,
            messages=[
                SystemMessage("You are a code diff generator which produces clean unified diff based on findings of the code review."),
                HumanMessage(prompt_diff)
            ]
        )).content

    except Exception as e:
        logger.warning(f"output_json generation failed: {e}")

    try:
        output_json = json.dumps(findings, indent=2, default=str)
    except Exception as e:
        logger.warning(f"output_json generation failed: {e}")

    try:
        cross_taint_section = state['cross_file_findings'] or "None"
        unresolved_imports_section = state['unresolved_imports'] or "None"

        output_markdown = f"""## Code Change Summary
- **Language:** {state['language']}
- **Lines Changed:** {state['lines_changed']} ({state['percent_changed']}%)
- **Functions Modified:** {state['functions_modified']}
- **Functions Added:** {state['functions_added']}
- **Agents Invoked:** {state['agents_required']}

## Judge Evaluation
- **Judge Score:** {state['judge_score']}
- **Judge Verdict:** {state['judge_verdict']}
- **Coverage:** {state['coverage']}
- **Accuracy:** {state['accuracy']}
- **Fix Quality:** {state['fix_quality']}
- **Consistency:** {state['consistency']}
- **Retry Count:** {state['retry_count']}
- **Forced Output:** {state['forced']}

## Cross-File Taint Flows
{cross_taint_section}

## Unresolved Imports (Cross-Taint Analysis)
{unresolved_imports_section}

## Findings
{markdown_findings(findings)}
"""
    except Exception as e:
        logger.warning(f"output_markdown generation failed: {e}")

    return {
        'output_json': output_json,
        'output_diff': output_diff,
        'output_markdown': output_markdown
    }