import type { ReactNode } from "react";
import { analyticsFontBody, analyticsFontMono } from "./_design/fonts";
import "./_design/tokens.css";

export const metadata = {
    title: "Data Analysis",
};

export default function AnalyticsLayout({ children }: { children: ReactNode }) {
    return (
        <div className={`analytics-scope ${analyticsFontBody.className} ${analyticsFontMono.variable}`}>
            {children}
        </div>
    );
}
