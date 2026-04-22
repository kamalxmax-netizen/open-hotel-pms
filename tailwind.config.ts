import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  safelist: [
    "border-sky-200",
    "bg-sky-50/70",
    "bg-sky-50/85",
    "bg-sky-100/70",
    "bg-sky-100",
    "text-sky-700",
    "border-violet-200",
    "bg-violet-50/70",
    "bg-violet-50/85",
    "bg-violet-100/70",
    "bg-violet-100",
    "text-violet-700",
    "border-fuchsia-200",
    "bg-fuchsia-50/70",
    "bg-fuchsia-50/85",
    "bg-fuchsia-100/70",
    "bg-fuchsia-100",
    "text-fuchsia-700",
    "border-emerald-200",
    "bg-emerald-50/60",
    "bg-emerald-50/70",
    "bg-emerald-100/70",
    "text-emerald-700",
    "[&>td]:bg-sky-50/70",
    "[&>td]:bg-sky-100/70",
    "[&>td]:bg-violet-50/70",
    "[&>td]:bg-violet-100/70",
    "[&>td]:bg-fuchsia-50/70",
    "[&>td]:bg-fuchsia-100/70",
    "[&>td]:bg-emerald-50/70",
    "[&>td]:bg-emerald-100/70",
    "[&>td]:bg-slate-50"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#edf7ff",
          100: "#d6ebff",
          200: "#add7ff",
          300: "#74bbff",
          400: "#3a97ff",
          500: "#1278f2",
          600: "#075ecf",
          700: "#094ca8",
          800: "#0d417f",
          900: "#113965"
        },
        state: {
          available: "#0f9f64",
          reserved: "#e3a008",
          dirty: "#dc2626",
          cleaning: "#2563eb",
          cleaned: "#0ea5e9",
          approved: "#16a34a",
          closed: "#64748b"
        }
      }
    }
  },
  plugins: [
    plugin(({ addVariant }) => {
      addVariant('hc', 'html.high-contrast &');
    })
  ]
};

export default config;
