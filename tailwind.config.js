/** @type {import('tailwindcss').Config} */
const rgb = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: rgb("bg"),
        surface: rgb("surface"),
        panel: rgb("panel"),
        raised: rgb("raised"),
        hairline: rgb("hairline"),
        divider: rgb("divider"),
        text: rgb("text"),
        muted: rgb("muted"),
        faint: rgb("faint"),
        action: { DEFAULT: rgb("action"), deep: rgb("action-deep"), soft: rgb("action-soft") },
        violet: rgb("violet"),
        emerald: rgb("emerald"),
        sky: rgb("sky"),
        amber: rgb("amber"),
        ok: { DEFAULT: rgb("ok"), soft: rgb("ok-soft"), text: rgb("ok-text") },
        warn: { DEFAULT: rgb("warn"), soft: rgb("warn-soft"), text: rgb("warn-text") },
        danger: { DEFAULT: rgb("danger"), soft: rgb("danger-soft"), text: rgb("danger-text") },
        info: { DEFAULT: rgb("info"), soft: rgb("info-soft"), text: rgb("info-text") },
        ai: { DEFAULT: rgb("ai"), soft: rgb("ai-soft") },
        attn: rgb("attn-head"),
        overlay: rgb("overlay"),
      },
      borderRadius: {
        sm: "6px",
        DEFAULT: "8px",
        md: "8px",
        lg: "10px",
        xl: "12px",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      fontSize: {
        "2xs": ["11px", "1.4"],
        xs: ["12px", "1.45"],
        sm: ["13px", "1.5"],
        base: ["15px", "1.55"],
      },
      boxShadow: {
        panel: "0 1px 2px rgb(0 0 0 / .5), 0 10px 30px rgb(0 0 0 / .35)",
      },
      ringColor: {
        DEFAULT: rgb("ring"),
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-in-right": {
          from: { transform: "translateX(16px)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        "pulse-rec": { "0%,100%": { opacity: "1" }, "50%": { opacity: ".25" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: {
        "fade-in": "fade-in .18s ease-out",
        "slide-in-right": "slide-in-right .22s cubic-bezier(.22,.61,.36,1)",
        "pulse-rec": "pulse-rec 1.6s ease-in-out infinite",
        shimmer: "shimmer 1.4s infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
