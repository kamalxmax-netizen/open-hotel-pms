// D17: next/font ships with Next 14 — no separate dep.
import { Inter, JetBrains_Mono } from "next/font/google";

export const analyticsFontBody = Inter({
    subsets: ["latin"],
    variable: "--a-font-body-next",
    display: "swap",
});

export const analyticsFontMono = JetBrains_Mono({
    subsets: ["latin"],
    variable: "--a-font-mono-next",
    display: "swap",
});
