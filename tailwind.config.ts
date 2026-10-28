import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./packages/oms-ac-login/src/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    fontSize: {
      xs: ["1rem", { lineHeight: "1.5rem" }],
      sm: ["1.125rem", { lineHeight: "1.75rem" }],
      base: ["1.25rem", { lineHeight: "1.875rem" }],
      lg: ["1.375rem", { lineHeight: "1.875rem" }],
      xl: ["1.5rem", { lineHeight: "2rem" }],
      "2xl": ["1.75rem", { lineHeight: "2.25rem" }],
      "3xl": ["2.25rem", { lineHeight: "2.625rem" }],
      "4xl": ["2.75rem", { lineHeight: "3.125rem" }],
      "5xl": ["3.5rem", { lineHeight: "1.1" }],
      "6xl": ["4rem", { lineHeight: "1.05" }],
      "7xl": ["4.75rem", { lineHeight: "1" }],
      "8xl": ["6.25rem", { lineHeight: "1" }],
      "9xl": ["8.25rem", { lineHeight: "1" }]
    },
    extend: {
      colors: {
        ink: "rgb(var(--color-ink) / <alpha-value>)",
        mist: "rgb(var(--color-mist) / <alpha-value>)",
        lagoon: "#0e7c86",
        saffron: "#d89216",
        coral: "#c64f4a",
        brand: { DEFAULT: "#0056d2", deep: "#00419e", soft: "#eaf2ff" }
      },
      boxShadow: {
        panel: "0 18px 48px rgba(23, 32, 42, 0.10)"
      }
    }
  },
  plugins: []
};

export default config;
