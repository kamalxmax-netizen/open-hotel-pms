import type { VarianceTier } from "@/lib/analytics/types";

const LABEL: Record<VarianceTier, string> = {
    green: "Healthy",
    yellow: "Watch",
    red: "Alert",
    na: "N/A",
};

export function VarianceBadge({ tier }: { tier: VarianceTier }) {
    return <span className={`a-badge a-badge-${tier}`}>{LABEL[tier]}</span>;
}
