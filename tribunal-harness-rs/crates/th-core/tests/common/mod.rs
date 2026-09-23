//! Shared helpers for the fixture-diff tests.

use serde_json::Value;
use std::path::PathBuf;

pub fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
}

pub fn load(rel: &str) -> Value {
    let p = fixtures_dir().join(rel);
    let text = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {}: {e}", p.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", p.display()))
}

/// Compare two JSON values as their compact serialisation, which checks key
/// ORDER as well as content (the fixtures were parsed with `preserve_order`).
#[track_caller]
pub fn assert_json_eq(actual: &Value, expected: &Value, context: &str) {
    let a = serde_json::to_string(actual).unwrap();
    let e = serde_json::to_string(expected).unwrap();
    if a != e {
        // Find the first differing position for a readable message.
        let idx = a.bytes().zip(e.bytes()).position(|(x, y)| x != y).unwrap_or(a.len().min(e.len()));
        let lo = idx.saturating_sub(120);
        panic!(
            "JSON mismatch ({context})\n  first difference at byte {idx}\n  actual  : …{}…\n  expected: …{}…",
            &a[lo..(idx + 160).min(a.len())],
            &e[lo..(idx + 160).min(e.len())]
        );
    }
}

/// Serialise a value to `Value` (via serde) for comparison.
pub fn to_value<T: serde::Serialize>(v: &T) -> Value {
    serde_json::to_value(v).unwrap()
}

pub fn opt_str(v: &Value) -> Option<&str> {
    v.as_str()
}
