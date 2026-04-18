export const RECHARTS_THEME = {
    grid: "#242834",
    axis: "#5d6476",
    tooltipBg: "#1a1d26",
    tooltipBorder: "#242834",
    tooltipText: "#e6e8ef",
    series: {
        actual: "#22d3ee",
        predict: "#a78bfa",
        max: "#f59e0b",
        statistical: "#10b981",
    },
};

export const RECHARTS_TOOLTIP_STYLE = {
    backgroundColor: RECHARTS_THEME.tooltipBg,
    border: `1px solid ${RECHARTS_THEME.tooltipBorder}`,
    borderRadius: 6,
    color: RECHARTS_THEME.tooltipText,
    fontFamily: "JetBrains Mono, ui-monospace, monospace",
    fontSize: 12,
} as const;
