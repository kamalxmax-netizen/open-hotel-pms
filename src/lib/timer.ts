/**
 * timer.ts
 * Utility functions for housekeeping task timing calculations.
 */

/**
 * Parses an ISO 8601 duration string (e.g. "PT1H30M") into total minutes.
 * A fallback mechanism in case cleaning_duration_min is stored as interval.
 */
export function parseIsoDurationToMinutes(durationStr: string | null): number {
    if (!durationStr) return 0;

    // Basic RegExp for common patterns (hours, minutes)
    const regex = /P(?:([0-9]+)D)?T(?:([0-9]+)H)?(?:([0-9]+)M)?(?:([0-9]+)S)?/;
    const match = durationStr.match(regex);

    if (!match) return 0;

    const hours = parseInt(match[2] || "0", 10);
    const minutes = parseInt(match[3] || "0", 10);

    return hours * 60 + minutes;
}

/**
 * Computes elapsed milliseconds considering currently accumulated MS and the last started timestamp.
 * 
 * @param startedAt The ISO string of when the task was last started (or null if not running)
 * @param accumulatedMs Total ms elapsed before the current run segment
 * @returns Total elapsed milliseconds
 */
export function computeElapsedMs(startedAt: string | null, accumulatedMs: number): number {
    if (!startedAt) {
        // If not currently running (e.g., paused), elapsed is exactly the accumulatedMs
        return accumulatedMs;
    }

    const now = Date.now();
    const startedTime = new Date(startedAt).getTime();

    // Defensive check against clock skew or bad data
    if (isNaN(startedTime) || now < startedTime) {
        return accumulatedMs;
    }

    return accumulatedMs + (now - startedTime);
}

/**
 * Formats milliseconds into a standard HH:MM:SS string format.
 * 
 * @param ms Total milliseconds
 * @returns Formatted time string, e.g., "01:25:05" for 1h 25m 5s
 */
export function formatDuration(ms: number): string {
    if (isNaN(ms) || ms < 0) return "00:00:00";

    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const h = hours.toString().padStart(2, "0");
    const m = minutes.toString().padStart(2, "0");
    const s = seconds.toString().padStart(2, "0");

    return `${h}:${m}:${s}`;
}

/**
 * Converts milliseconds to whole seconds.
 */
export function toSeconds(ms: number): number {
    return Math.floor(ms / 1000);
}
