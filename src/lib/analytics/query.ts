import type { AnalyticsQuery, AnalyticsWindow } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_WINDOWS: AnalyticsWindow[] = ["day", "week", "month"];

export class AnalyticsQueryError extends Error {
    status = 400;
    constructor(message: string) {
        super(message);
        this.name = "AnalyticsQueryError";
    }
}

export function parseAnalyticsQuery(searchParams: URLSearchParams): AnalyticsQuery {
    const window = searchParams.get("window");
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    if (!window || !VALID_WINDOWS.includes(window as AnalyticsWindow)) {
        throw new AnalyticsQueryError("window must be one of: day, week, month");
    }
    if (!start || !ISO_DATE.test(start)) {
        throw new AnalyticsQueryError("start must be a YYYY-MM-DD date");
    }
    if (!end || !ISO_DATE.test(end)) {
        throw new AnalyticsQueryError("end must be a YYYY-MM-DD date");
    }
    if (start > end) {
        throw new AnalyticsQueryError("start must be <= end");
    }

    const category = searchParams.get("category");
    const room_type = searchParams.get("room_type");

    return {
        window: window as AnalyticsWindow,
        start,
        end,
        category: category ? category.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
        room_type: room_type ? room_type.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    };
}

export function toURLSearchParams(q: AnalyticsQuery): URLSearchParams {
    const p = new URLSearchParams();
    p.set("window", q.window);
    p.set("start", q.start);
    p.set("end", q.end);
    if (q.category && q.category.length > 0) p.set("category", q.category.join(","));
    if (q.room_type && q.room_type.length > 0) p.set("room_type", q.room_type.join(","));
    return p;
}
