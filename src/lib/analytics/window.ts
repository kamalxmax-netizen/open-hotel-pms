// D15: ISO week = Monday–Sunday. Uses date-fns (already in deps).
import {
    startOfISOWeek,
    endOfISOWeek,
    startOfMonth,
    endOfMonth,
    startOfDay,
    endOfDay,
    format,
    eachDayOfInterval,
    eachWeekOfInterval,
    eachMonthOfInterval,
} from "date-fns";
import type { AnalyticsWindow } from "./types";

export function windowStart(date: Date, window: AnalyticsWindow): Date {
    switch (window) {
        case "day": return startOfDay(date);
        case "week": return startOfISOWeek(date);
        case "month": return startOfMonth(date);
    }
}

export function windowEnd(date: Date, window: AnalyticsWindow): Date {
    switch (window) {
        case "day": return endOfDay(date);
        case "week": return endOfISOWeek(date);
        case "month": return endOfMonth(date);
    }
}

export function formatISODate(d: Date): string {
    return format(d, "yyyy-MM-dd");
}

export function enumeratePeriods(start: Date, end: Date, window: AnalyticsWindow): Date[] {
    const interval = { start, end };
    switch (window) {
        case "day": return eachDayOfInterval(interval);
        case "week": return eachWeekOfInterval(interval, { weekStartsOn: 1 });
        case "month": return eachMonthOfInterval(interval);
    }
}
