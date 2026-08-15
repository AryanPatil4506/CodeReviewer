import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: {
          950: "#05070C",
          900: "#0B0E14",
          800: "#10141F",
          700: "#161B29",
          600: "#1E2436",
        },
        signal: {
          DEFAULT: "#22D3EE",
          soft: "#67E8F9",
          dim: "#0E7490",
        },
        synth: {
          DEFAULT: "#A78BFA",
          soft: "#C4B5FD",
        },
        ok: {
          DEFAULT: "#34D399",
          soft: "#6EE7B7",
        },
        warn: {
          DEFAULT: "#FBBF24",
        },
        danger: {
          DEFAULT: "#FB7185",
          soft: "#FDA4AF",
        },
      },
      fontFamily: {
        display: ["'Space Grotesk'", "system-ui", "sans-serif"],
        body: ["'Inter'", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      boxShadow: {
        "glow-signal": "0 0 0 1px rgba(34,211,238,0.4), 0 0 24px rgba(34,211,238,0.35)",
        "glow-ok": "0 0 0 1px rgba(52,211,153,0.4), 0 0 20px rgba(52,211,153,0.3)",
        "glow-danger": "0 0 0 1px rgba(251,113,133,0.45), 0 0 20px rgba(251,113,133,0.35)",
        "glow-synth": "0 0 0 1px rgba(167,139,250,0.4), 0 0 18px rgba(167,139,250,0.3)",
      },
      backgroundImage: {
        "grid-fine":
          "linear-gradient(rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px)",
      },
      backgroundSize: {
        "grid-fine": "28px 28px",
      },
      keyframes: {
        "pulse-ring": {
          "0%": { transform: "scale(0.9)", opacity: "0.8" },
          "70%": { transform: "scale(1.6)", opacity: "0" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
        scanline: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
      },
      animation: {
        "pulse-ring": "pulse-ring 1.8s cubic-bezier(0.4,0,0.6,1) infinite",
        scanline: "scanline 6s linear infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
