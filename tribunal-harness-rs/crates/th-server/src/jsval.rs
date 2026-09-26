//! JavaScript value semantics the route handlers depend on: truthiness,
//! template-literal stringification, UTF-16 string lengths and `substring`.

use serde_json::Value;
use th_core::jsnum::js_number_to_string;

/// `!!v` — `undefined`/`null`/`false`/`0`/`NaN`/`""` are falsy.
pub fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0 && !f.is_nan()).unwrap_or(true),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// `${v}` — how a template literal renders a JSON value.
pub fn template(v: &Value) -> String {
    match v {
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => js_number_to_string(n),
        Value::String(s) => s.clone(),
        Value::Array(items) => items
            .iter()
            .map(|x| match x {
                Value::Null => String::new(),
                other => template(other),
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".to_string(),
    }
}

/// `${v}` where `v` may be `undefined`.
pub fn template_or_undefined(v: Option<&Value>) -> String {
    v.map(template).unwrap_or_else(|| "undefined".to_string())
}

/// `String.prototype.length` (UTF-16 code units).
pub fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// `s.substring(0, end)` in UTF-16 code units.
pub fn substring_to(s: &str, end: usize) -> String {
    if utf16_len(s) <= end {
        return s.to_string();
    }
    let units: Vec<u16> = s.encode_utf16().take(end).collect();
    String::from_utf16_lossy(&units)
}

/// `String.prototype.trim()` — Unicode white space plus U+FEFF.
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

/// `Object.keys(v).length` for the values the analyse route inspects.
pub fn object_keys_len(v: &Value) -> usize {
    match v {
        Value::Object(m) => m.len(),
        Value::Array(a) => a.len(),
        Value::String(s) => utf16_len(s),
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn semantics() {
        assert!(!truthy(Some(&json!(""))));
        assert!(!truthy(Some(&json!(0))));
        assert!(truthy(Some(&json!("x"))));
        assert!(truthy(Some(&json!([]))));
        assert!(!truthy(None));
        assert_eq!(template(&json!(12345)), "12345");
        assert_eq!(template(&json!([1, null, "a"])), "1,,a");
        assert_eq!(template(&json!({"a": 1})), "[object Object]");
        assert_eq!(template_or_undefined(None), "undefined");
        assert_eq!(substring_to("héllo", 2), "hé");
        assert_eq!(utf16_len("😀"), 2);
        assert_eq!(object_keys_len(&json!({"a": 1, "b": 2})), 2);
    }
}
