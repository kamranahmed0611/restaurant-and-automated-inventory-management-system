import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: "var(--card)",
        cardForeground: "var(--card-foreground)",
        border: "var(--border)",
        primary: "var(--primary)",
        primaryForeground: "var(--primary-foreground)",
        muted: "var(--muted)",
        mutedForeground: "var(--muted-foreground)",
      },
    },
  },
  plugins: [],
};
export default config;
