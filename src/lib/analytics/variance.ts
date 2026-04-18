import type { AnalyticsBaseline, VarianceBucket, VarianceTier } from "./types";

const ALERT_THRESHOLD_PCT = 10;

export function computePct(actual: number, baseline: AnalyticsBaseline | null): number | null {
    if (!baseline || baseline.value <= 0) return null;
    return (actual / baseline.value) * 100;
}

function tierForPct(pct: number): VarianceTier {
    if (pct >= 90 && pct <= 110) return "green";
    if ((pct >= 70 && pct < 90) || (pct > 110 && pct <= 130)) return "yellow";
    return "red";
}

function rankTier(t: VarianceTier): number {
    switch (t) {
        case "green": return 0;
        case "yellow": return 1;
        case "red": return 2;
        case "na": return -1;
    }
}

export function computeBucket(args: {
    category: string;
    label: string;
    actual: number;
    baselines: VarianceBucket["baselines"];
}): VarianceBucket {
    const pct_vs_predict = computePct(args.actual, args.baselines.predict);
    const pct_vs_statistical = computePct(args.actual, args.baselines.statistical);
    const pct_vs_max = computePct(args.actual, args.baselines.max);

    const validPcts = [pct_vs_predict, pct_vs_statistical, pct_vs_max].filter(
        (p): p is number => p !== null
    );

    let tier: VarianceTier = "na";
    let alert = false;

    if (validPcts.length > 0) {
        const tiers = validPcts.map(tierForPct);
        tier = tiers.reduce((worst, t) => (rankTier(t) > rankTier(worst) ? t : worst), "green" as VarianceTier);
        alert = validPcts.some((p) => Math.abs(p - 100) >= ALERT_THRESHOLD_PCT);
    }

    return {
        category: args.category,
        label: args.label,
        actual: args.actual,
        baselines: args.baselines,
        pct_vs_predict,
        pct_vs_statistical,
        pct_vs_max,
        tier,
        alert,
    };
}

export function worstTier(buckets: VarianceBucket[]): VarianceTier {
    const tiers = buckets.map((b) => b.tier).filter((t): t is Exclude<VarianceTier, "na"> => t !== "na");
    if (tiers.length === 0) return "na";
    return tiers.reduce<VarianceTier>(
        (worst, t) => (rankTier(t) > rankTier(worst) ? t : worst),
        "green"
    );
}
