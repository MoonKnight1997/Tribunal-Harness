/**
 * Legal-date helpers. All legal dates are ISO YYYY-MM-DD strings handled in
 * UTC. Never construct a legal date from `new Date(string)` with local-time
 * methods: DST shifts produce off-by-one errors.
 */

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
    if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
    const [y, m, d] = value.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function parseUTC(iso: string): Date {
    if (!isIsoDate(iso)) throw new Error(`Invalid date (expected YYYY-MM-DD): ${String(iso)}`);
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

export function toISODate(d: Date): string {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

export function todayISO(now: Date = new Date()): string {
    return toISODate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
}

export function addDays(iso: string, days: number): string {
    const d = parseUTC(iso);
    d.setUTCDate(d.getUTCDate() + days);
    return toISODate(d);
}

export function daysBetween(fromIso: string, toIso: string): number {
    const ms = parseUTC(toIso).getTime() - parseUTC(fromIso).getTime();
    return Math.round(ms / 86_400_000);
}

export function compareIso(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/** "14 April 2026" for user-facing copy. */
export function formatLongDate(iso: string | null | undefined): string {
    if (!iso || !isIsoDate(iso)) return "date not known";
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(parseUTC(iso));
}
