import { memo } from "react";
import { BaseEdge, type EdgeProps, getSmoothStepPath } from "@xyflow/react";
import { useExecutionStore } from "@/store/executionStore";

function FlowEdgeImpl({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
}: EdgeProps) {
  const sourceState = useExecutionStore((s) => s.nodeStates[source]);
  const targetState = useExecutionStore((s) => s.nodeStates[target]);

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 12,
  });

  const flowing = sourceState?.status === "completed" && targetState?.status === "running";
  const failedHandoff = targetState?.status === "failed";
  const settled = sourceState?.status === "completed" && targetState?.status === "completed";

  const stroke = failedHandoff ? "#FB7185" : flowing ? "#22D3EE" : settled ? "#34D399" : "rgba(148,163,184,0.35)";
  const strokeWidth = flowing ? 2 : 1.5;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke,
          strokeWidth,
          strokeDasharray: failedHandoff ? "4 3" : undefined,
          opacity: sourceState?.status === "pending" ? 0.35 : 0.9,
          transition: "stroke 0.3s ease, opacity 0.3s ease",
        }}
      />
      {flowing && (
        <circle r="3.5" fill="#67E8F9">
          <animateMotion dur="1.1s" repeatCount="indefinite" path={edgePath} />
        </circle>
      )}
    </>
  );
}

export const FlowEdge = memo(FlowEdgeImpl);
