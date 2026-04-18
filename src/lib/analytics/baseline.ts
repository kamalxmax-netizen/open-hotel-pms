import type { AnalyticsBaseline, BaselineSource } from "./types";

// D16: max = units_per_room × active_rooms × days_in_period.
// Concrete setup tables wire in during Phase 68.1/68.2.
export function maxBaseline(params: {
    units_per_room: number;
    active_rooms: number;
    days_in_period: number;
}): AnalyticsBaseline {
    const value = params.units_per_room * params.active_rooms * params.days_in_period;
    return { source: "max", value };
}

export function predictBaseline(value: number): AnalyticsBaseline {
    return { source: "predict", value: Math.max(0, value) };
}

// D7/D11: statistical is null until Phase 67 extracts raw history.
export function statisticalBaseline(
    value: number,
    computed_from: NonNullable<AnalyticsBaseline["computed_from"]>
): AnalyticsBaseline {
    return { source: "statistical", value: Math.max(0, value), computed_from };
}

export function emptyBaseline(source: BaselineSource): AnalyticsBaseline {
    return { source, value: 0 };
}
