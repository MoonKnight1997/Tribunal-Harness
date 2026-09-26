//! Shared in-memory rate limiter for the LLM-backed API routes. Port of
//! `src/lib/rate-limit.ts`. DEMO / single-instance only.

use std::collections::HashMap;
use std::sync::Mutex;

/// F-20: derive the rate-limit key from the trusted proxy hop only — the
/// LAST entry of `X-Forwarded-For`; `unknown-ip` when absent.
pub fn client_key_from_xff(xff: Option<&str>) -> String {
    if let Some(v) = xff {
        let hops: Vec<&str> = v.split(',').map(str::trim).filter(|h| !h.is_empty()).collect();
        if let Some(last) = hops.last() {
            return last.to_string();
        }
    }
    "unknown-ip".to_string()
}

/// Fixed-window limiter with per-key buckets and eviction of fully elapsed
/// windows so the map never grows without bound.
pub struct RateLimiter {
    window_ms: i64,
    max_requests: usize,
    map: Mutex<HashMap<String, Vec<i64>>>,
}

impl RateLimiter {
    pub fn new(window_ms: i64, max_requests: usize) -> Self {
        Self { window_ms, max_requests, map: Mutex::new(HashMap::new()) }
    }

    /// True if the request is within the limit; false if it should be 429'd.
    pub fn check(&self, key: &str, now_ms: i64) -> bool {
        let mut map = self.map.lock().unwrap_or_else(|e| e.into_inner());
        map.retain(|_, ts| !(ts.is_empty() || *ts.last().unwrap() <= now_ms - self.window_ms));
        let mut recent: Vec<i64> = map.get(key).cloned().unwrap_or_default().into_iter().filter(|t| now_ms - t < self.window_ms).collect();
        if recent.len() >= self.max_requests {
            map.insert(key.to_string(), recent);
            return false;
        }
        recent.push(now_ms);
        map.insert(key.to_string(), recent);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_and_windows() {
        let rl = RateLimiter::new(1000, 3);
        assert!(rl.check("a", 0));
        assert!(rl.check("a", 1));
        assert!(rl.check("a", 2));
        assert!(!rl.check("a", 3));
        assert!(rl.check("b", 3));
        assert!(rl.check("a", 1002));
        assert_eq!(client_key_from_xff(Some("1.1.1.1, 2.2.2.2, 3.3.3.3")), "3.3.3.3");
        assert_eq!(client_key_from_xff(Some("9.9.9.9")), "9.9.9.9");
        assert_eq!(client_key_from_xff(None), "unknown-ip");
        assert_eq!(client_key_from_xff(Some(",,,")), "unknown-ip");
    }
}
