//! UTC civil-date arithmetic with the exact semantics the TypeScript app gets
//! from `Date.UTC(...)` / `getUTC*()`: proleptic Gregorian calendar, no time
//! zones, day arithmetic via days-since-epoch.
//!
//! Only what the deadline calculator, qualifying-period service and date
//! formatters need is implemented. Every date between 2024 and 2029 is
//! exercised against fixtures recorded from the TypeScript app.

use std::cmp::Ordering;
use std::fmt;

/// A calendar date in UTC (year, month 1..=12, day 1..=31).
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct CivilDate {
    pub year: i32,
    pub month: u32,
    pub day: u32,
}

const MONTH_NAMES: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

const MONTH_SHORT: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec",
];

pub fn is_leap(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

pub fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap(year) {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

/// True iff `s` matches `^\d{4}-\d{2}-\d{2}$` (ASCII digits only), the same
/// shape test the TypeScript sources apply before any calendar check.
pub fn is_iso_shape(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| if i == 4 || i == 7 { true } else { c.is_ascii_digit() })
}

impl CivilDate {
    pub const fn new(year: i32, month: u32, day: u32) -> Self {
        Self { year, month, day }
    }

    /// Whether the (y, m, d) triple is a real proleptic-Gregorian date.
    pub fn is_valid(&self) -> bool {
        self.month >= 1 && self.month <= 12 && self.day >= 1 && self.day <= days_in_month(self.year, self.month)
    }

    /// Parse `YYYY-MM-DD` with the semantics of the TypeScript `parseUTC` /
    /// `parseUTCStrict` helpers: the shape must match, the calendar date must
    /// exist (no silent overflow), and — because `Date.UTC(y, ...)` maps years
    /// 0..=99 onto 1900..=1999 and the round-trip check then fails — years
    /// below 100 are rejected.
    pub fn parse_utc(iso: &str) -> Option<CivilDate> {
        if !is_iso_shape(iso) {
            return None;
        }
        let year: i32 = iso[0..4].parse().ok()?;
        let month: u32 = iso[5..7].parse().ok()?;
        let day: u32 = iso[8..10].parse().ok()?;
        if year < 100 {
            return None;
        }
        let d = CivilDate::new(year, month, day);
        if d.is_valid() {
            Some(d)
        } else {
            None
        }
    }

    /// Parse with the semantics of `new Date("YYYY-MM-DDT00:00:00Z")` followed
    /// by a `toISOString().slice(0, 10) === value` round trip (used by
    /// `constants.ts:isValidIsoDate`). Unlike [`CivilDate::parse_utc`] this
    /// accepts years 0..=99.
    pub fn parse_iso_string(iso: &str) -> Option<CivilDate> {
        if !is_iso_shape(iso) {
            return None;
        }
        let year: i32 = iso[0..4].parse().ok()?;
        let month: u32 = iso[5..7].parse().ok()?;
        let day: u32 = iso[8..10].parse().ok()?;
        let d = CivilDate::new(year, month, day);
        if d.is_valid() {
            Some(d)
        } else {
            None
        }
    }

    /// Days since 1970-01-01 (Howard Hinnant's `days_from_civil`).
    pub fn days_from_epoch(&self) -> i64 {
        let y = if self.month <= 2 { self.year as i64 - 1 } else { self.year as i64 };
        let era = if y >= 0 { y } else { y - 399 } / 400;
        let yoe = y - era * 400;
        let m = self.month as i64;
        let d = self.day as i64;
        let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        era * 146097 + doe - 719468
    }

    /// Inverse of [`CivilDate::days_from_epoch`].
    pub fn from_days(days: i64) -> CivilDate {
        let z = days + 719468;
        let era = if z >= 0 { z } else { z - 146096 } / 146097;
        let doe = z - era * 146097;
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        let y = yoe + era * 400;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
        let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
        let year = if m <= 2 { y + 1 } else { y } as i32;
        CivilDate::new(year, m, d)
    }

    pub fn add_days(&self, n: i64) -> CivilDate {
        CivilDate::from_days(self.days_from_epoch() + n)
    }

    /// 0 = Sunday … 6 = Saturday (matches `Date.prototype.getUTCDay`).
    pub fn weekday(&self) -> u32 {
        let d = self.days_from_epoch();
        // 1970-01-01 was a Thursday (4).
        (((d % 7) + 7 + 4) % 7) as u32
    }

    /// Milliseconds since the epoch at UTC midnight (`Date.UTC(y, m-1, d)`).
    pub fn epoch_ms(&self) -> i64 {
        self.days_from_epoch() * 86_400_000
    }

    /// `YYYY-MM-DD`, zero padded (`toISOString().slice(0, 10)` for years
    /// 0..=9999).
    pub fn to_iso(&self) -> String {
        format!("{:04}-{:02}-{:02}", self.year, self.month, self.day)
    }

    /// `toISOString()` at UTC midnight: `YYYY-MM-DDT00:00:00.000Z`.
    pub fn to_iso_datetime(&self) -> String {
        format!("{}T00:00:00.000Z", self.to_iso())
    }

    /// `Intl.DateTimeFormat("en-GB", {day:"numeric", month:"long", year:"numeric", timeZone:"UTC"})`
    /// → `1 January 2027`.
    pub fn format_long(&self) -> String {
        format!("{} {} {}", self.day, MONTH_NAMES[(self.month - 1) as usize], self.year)
    }

    /// `Intl.DateTimeFormat("en-GB", {month:"long", year:"numeric", timeZone:"UTC"})`
    /// → `January 2027`.
    pub fn format_month_year(&self) -> String {
        format!("{} {}", MONTH_NAMES[(self.month - 1) as usize], self.year)
    }

    /// `toLocaleDateString("en-GB", {day:"numeric", month:"short", year:"numeric"})`
    /// → `15 Sept 2025` (modern ICU abbreviates September as "Sept" in en-GB).
    pub fn format_short(&self) -> String {
        format!("{} {} {}", self.day, MONTH_SHORT[(self.month - 1) as usize], self.year)
    }
}

impl PartialOrd for CivilDate {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for CivilDate {
    fn cmp(&self, other: &Self) -> Ordering {
        self.days_from_epoch().cmp(&other.days_from_epoch())
    }
}

impl fmt::Debug for CivilDate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_iso())
    }
}

impl fmt::Display for CivilDate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_iso())
    }
}

/// The UTC calendar date containing the given epoch instant (milliseconds).
pub fn civil_from_epoch_ms(ms: i64) -> CivilDate {
    CivilDate::from_days(ms.div_euclid(86_400_000))
}

/// `new Date(ms).toISOString()` — full ISO-8601 timestamp with milliseconds.
pub fn iso_datetime_from_epoch_ms(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    let rem = ms.rem_euclid(86_400_000);
    let date = CivilDate::from_days(days);
    let h = rem / 3_600_000;
    let m = (rem % 3_600_000) / 60_000;
    let s = (rem % 60_000) / 1000;
    let millis = rem % 1000;
    format!("{}T{:02}:{:02}:{:02}.{:03}Z", date.to_iso(), h, m, s, millis)
}

/// Clock abstraction so calculations that depend on "now" are testable.
pub trait Clock: Send + Sync {
    fn now_epoch_ms(&self) -> i64;
    fn today_utc(&self) -> CivilDate {
        civil_from_epoch_ms(self.now_epoch_ms())
    }
}

/// System clock.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_epoch_ms(&self) -> i64 {
        let d = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default();
        d.as_millis() as i64
    }
}

/// A frozen clock for tests and fixture replays.
#[derive(Debug, Clone, Copy)]
pub struct FixedClock(pub i64);

impl FixedClock {
    /// UTC midnight of the given date.
    pub fn at_date(d: CivilDate) -> Self {
        FixedClock(d.epoch_ms())
    }
}

impl Clock for FixedClock {
    fn now_epoch_ms(&self) -> i64 {
        self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_every_day_of_a_decade() {
        let start = CivilDate::new(2020, 1, 1).days_from_epoch();
        for n in 0..(366 * 10) {
            let d = CivilDate::from_days(start + n);
            assert!(d.is_valid());
            assert_eq!(d.days_from_epoch(), start + n);
            assert_eq!(CivilDate::parse_utc(&d.to_iso()), Some(d));
        }
    }

    #[test]
    fn weekday_matches_known_dates() {
        assert_eq!(CivilDate::new(1970, 1, 1).weekday(), 4);
        assert_eq!(CivilDate::new(2025, 8, 31).weekday(), 0); // Sunday
        assert_eq!(CivilDate::new(2025, 7, 5).weekday(), 6); // Saturday
        assert_eq!(CivilDate::new(2025, 4, 14).weekday(), 1); // Monday
    }

    #[test]
    fn parse_rejects_like_typescript() {
        assert!(CivilDate::parse_utc("not-a-date").is_none());
        assert!(CivilDate::parse_utc("2026-02-31").is_none());
        assert!(CivilDate::parse_utc("2025-13-40").is_none());
        assert!(CivilDate::parse_utc("2025-1-1").is_none());
        assert!(CivilDate::parse_utc("0000-01-01").is_none());
        assert!(CivilDate::parse_utc("2024-02-29").is_some());
        assert!(CivilDate::parse_utc("2025-02-29").is_none());
        assert!(CivilDate::parse_iso_string("0050-01-01").is_some());
    }

    #[test]
    fn formats() {
        assert_eq!(CivilDate::new(2027, 1, 1).format_long(), "1 January 2027");
        assert_eq!(CivilDate::new(2026, 10, 1).format_month_year(), "October 2026");
        assert_eq!(iso_datetime_from_epoch_ms(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            iso_datetime_from_epoch_ms(1_774_000_000_123),
            "2026-03-20T09:46:40.123Z"
        );
    }
}
