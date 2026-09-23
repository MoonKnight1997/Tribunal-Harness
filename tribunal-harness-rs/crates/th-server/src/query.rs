//! `URLSearchParams`-compatible query-string parsing: `+` is a space, `%XX`
//! is percent-decoded (invalid sequences are kept literally), and `get`
//! returns the first value for a name.

pub struct Query(Vec<(String, String)>);

impl Query {
    pub fn parse(raw: Option<&str>) -> Self {
        let mut out = Vec::new();
        if let Some(raw) = raw {
            for pair in raw.split('&') {
                if pair.is_empty() {
                    continue;
                }
                let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
                out.push((decode(k), decode(v)));
            }
        }
        Self(out)
    }

    /// `searchParams.get(name)` — `None` when absent.
    pub fn get(&self, name: &str) -> Option<&str> {
        self.0.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() + 1 && i + 2 <= bytes.len() - 1 => match (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                (Some(h), Some(l)) => {
                    out.push(h * 16 + l);
                    i += 3;
                }
                _ => {
                    out.push(b'%');
                    i += 1;
                }
            },
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_like_url_search_params() {
        let q = Query::parse(Some("q=unfair%20dismissal&court=eat&x=a+b&y=%ZZ&z"));
        assert_eq!(q.get("q"), Some("unfair dismissal"));
        assert_eq!(q.get("court"), Some("eat"));
        assert_eq!(q.get("x"), Some("a b"));
        assert_eq!(q.get("y"), Some("%ZZ"));
        assert_eq!(q.get("z"), Some(""));
        assert_eq!(q.get("missing"), None);
        assert_eq!(Query::parse(None).get("q"), None);
        assert_eq!(Query::parse(Some("slug=%2Feat%2F2026%2F90%2F")).get("slug"), Some("/eat/2026/90/"));
        assert_eq!(Query::parse(Some("q=%5B2021%5D")).get("q"), Some("[2021]"));
    }
}
