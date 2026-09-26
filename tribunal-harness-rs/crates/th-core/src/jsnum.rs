//! Small helpers for reproducing JavaScript number/string semantics where the
//! TypeScript app's JSON output depends on them.

use serde_json::Value;

/// `JSON.stringify` prints an integral f64 without a fractional part (`33`,
/// not `33.0`). Use this when a computed float goes into a JSON body.
pub fn js_number(v: f64) -> Value {
    if v.is_finite() && v.fract() == 0.0 && v.abs() < 9.007_199_254_740_992e15 {
        Value::from(v as i64)
    } else {
        Value::from(v)
    }
}

/// `String(value)` for a JSON value: strings as-is, numbers/booleans via their
/// JS string form, everything else (`null`, objects, arrays) is the caller's
/// business (`asString` in the TypeScript code returns "" for those).
pub fn js_string_of_scalar(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Bool(b) => Some(b.to_string()),
        Value::Number(n) => Some(js_number_to_string(n)),
        _ => None,
    }
}

/// `String(n)` for a JSON number — integers print plainly, floats shortest
/// round-trip (close enough to V8 for the values that occur here).
pub fn js_number_to_string(n: &serde_json::Number) -> String {
    if let Some(i) = n.as_i64() {
        return i.to_string();
    }
    if let Some(u) = n.as_u64() {
        return u.to_string();
    }
    let f = n.as_f64().unwrap_or(0.0);
    if f.fract() == 0.0 && f.abs() < 1e21 {
        format!("{}", f as i64)
    } else {
        format!("{f}")
    }
}

/// `Number.parseInt(s, 10)`: skip leading whitespace, optional sign, then as
/// many ASCII digits as possible. Returns `None` for NaN.
pub fn js_parse_int(s: &str) -> Option<i64> {
    let t = s.trim_start_matches(|c: char| c.is_whitespace());
    let (neg, rest) = match t.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, t.strip_prefix('+').unwrap_or(t)),
    };
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return None;
    }
    let v: i64 = digits.parse().unwrap_or(i64::MAX);
    Some(if neg { -v } else { v })
}

/// `Number(s)` for the subset of forms that matter for path indices: trimmed
/// decimal (possibly with fraction/exponent); empty → 0; else NaN (`None`).
pub fn js_number_of_str(s: &str) -> Option<f64> {
    let t = s.trim();
    if t.is_empty() {
        return Some(0.0);
    }
    t.parse::<f64>().ok().filter(|f| f.is_finite())
}

/// `Math.round(x)` — half rounds toward +∞.
pub fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers() {
        assert_eq!(js_number(33.0).to_string(), "33");
        assert_eq!(js_number(0.175).to_string(), "0.175");
        assert_eq!(js_number(0.0).to_string(), "0");
        assert_eq!(js_parse_int("10"), Some(10));
        assert_eq!(js_parse_int("2abc"), Some(2));
        assert_eq!(js_parse_int("1.9"), Some(1));
        assert_eq!(js_parse_int("abc"), None);
        assert_eq!(js_parse_int("-5"), Some(-5));
        assert_eq!(js_parse_int(""), None);
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_number_of_str(""), Some(0.0));
        assert_eq!(js_number_of_str("1.0"), Some(1.0));
        assert_eq!(js_number_of_str("abc"), None);
    }
}
