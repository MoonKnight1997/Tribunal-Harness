//! Find Case Law — the pure parts of `src/services/find-case-law.ts`: Atom
//! feed parsing, citation normalisation, party-token cross-checks and the
//! VERIFIED/CHECK/QUARANTINED decision over a search envelope. The HTTP calls,
//! timeout handling and the 1-hour verification cache are in
//! `th-services::tna`.

use crate::types::TrustLevel;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

pub const TNA_BASE: &str = "https://caselaw.nationalarchives.gov.uk";
pub const DEFAULT_TIMEOUT_MS: u64 = 12_000;
pub const USER_AGENT: &str = "tribunal-harness/1.0 (UK employment tribunal legal-information tool)";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LookupStatus {
    Ok,
    Empty,
    NotFound,
    UpstreamTimeout,
    UpstreamUnavailable,
    Error,
}

impl LookupStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            LookupStatus::Ok => "ok",
            LookupStatus::Empty => "empty",
            LookupStatus::NotFound => "not_found",
            LookupStatus::UpstreamTimeout => "upstream_timeout",
            LookupStatus::UpstreamUnavailable => "upstream_unavailable",
            LookupStatus::Error => "error",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseLawHit {
    /// Neutral citation as published, e.g. "[2021] UKSC 5". `None` if absent.
    pub neutral_citation: Option<String>,
    pub title: String,
    pub court: Option<String>,
    /// Judgment date (YYYY-MM-DD).
    pub date: Option<String>,
    /// TNA slug, e.g. "eat/2026/90".
    pub slug: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchEnvelope {
    pub status: LookupStatus,
    pub results: Vec<CaseLawHit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VerifySource {
    #[serde(rename = "find_case_law")]
    FindCaseLaw,
    #[serde(rename = "unavailable")]
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyResult {
    pub trust_level: TrustLevel,
    pub reason: String,
    pub source: VerifySource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_citation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slug: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

static NAMED_ENTITY_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"&(amp|lt|gt|quot|apos|#39);").unwrap());
static HEX_ENTITY_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"&#x([0-9a-fA-F]+);").unwrap());
static DEC_ENTITY_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"&#(\d+);").unwrap());

/// Decode the handful of entities TNA feeds use; trims the result.
pub fn decode_entities(s: &str) -> String {
    let named = NAMED_ENTITY_RE.replace_all(s, |c: &regex::Captures| match &c[1] {
        "amp" => "&",
        "lt" => "<",
        "gt" => ">",
        "quot" => "\"",
        "apos" | "#39" => "'",
        _ => "",
    });
    let hex = HEX_ENTITY_RE.replace_all(&named, |c: &regex::Captures| {
        u32::from_str_radix(&c[1], 16).ok().and_then(char::from_u32).map(String::from).unwrap_or_default()
    });
    let dec = DEC_ENTITY_RE.replace_all(&hex, |c: &regex::Captures| {
        c[1].parse::<u32>().ok().and_then(char::from_u32).map(String::from).unwrap_or_default()
    });
    dec.trim().to_string()
}

/// Lowercase and strip everything but `[a-z0-9]`.
pub fn normalise_citation(c: &str) -> String {
    c.to_lowercase().chars().filter(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit()).collect()
}

const BOILERPLATE_PARTY_TOKENS: [&str; 9] = ["ltd", "plc", "llp", "and", "ors", "others", "limited", "group", "the"];

static PARTY_SPLIT_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\s+v\.?\s+").unwrap());
static NON_ALNUM_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)[^a-z0-9]+").unwrap());

/// Significant party tokens from a case name (tokens > 3 chars, minus boilerplate).
pub fn significant_party_tokens(name: &str) -> Vec<String> {
    PARTY_SPLIT_RE
        .split(name)
        .flat_map(|party| NON_ALNUM_RE.split(party).map(|t| t.to_lowercase()).collect::<Vec<_>>())
        .filter(|t| t.len() > 3 && !BOILERPLATE_PARTY_TOKENS.contains(&t.as_str()))
        .collect()
}

/// `/\[\s*\d{4}\s*\]\s*[A-Za-z][A-Za-z./ ]*?\s*\d+/` (this variant does NOT
/// accept underscores, unlike the citation validator's).
static NCN_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[\s*\d{4}\s*\]\s*[A-Za-z][A-Za-z./ ]*?\s*\d+").unwrap());
static WS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());

pub fn extract_neutral_citation(text: &str) -> Option<String> {
    NCN_RE.find(text).map(|m| WS_RE.replace_all(m.as_str(), " ").trim().to_string())
}

/// The raw (un-normalised) neutral-citation match, used when stripping it out
/// of a citation string to recover the party names.
pub fn raw_neutral_citation_match(text: &str) -> Option<&str> {
    NCN_RE.find(text).map(|m| m.as_str())
}

static ENTRY_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<entry>(.*?)</entry>").unwrap());
static TITLE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<title[^>]*>(.*?)</title>").unwrap());
static ID_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<tna:identifier\b([^>]*)>(.*?)</tna:identifier>").unwrap());
static TYPE_UKNCN_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"type="ukncn""#).unwrap());
static SLUG_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"slug="([^"]*)""#).unwrap());
static LINK_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<link\b([^>]*)/?>").unwrap());
static REL_ALT_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"rel="alternate""#).unwrap());
static TYPE_ATTR_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"type=").unwrap());
static HREF_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"href="([^"]*)""#).unwrap());
static COURT_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<author>.*?<name>(.*?)</name>").unwrap());
static PUB_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<published>(.*?)</published>").unwrap());
static TOTAL_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<(?:\w+:)?totalResults>\s*(\d+)\s*<").unwrap());

pub struct ParsedFeed {
    pub hits: Vec<CaseLawHit>,
    pub total: Option<u64>,
}

/// Parse the TNA Atom search feed into hits (defensive regex, no XML parser,
/// entities never expanded beyond the fixed table).
pub fn parse_atom_feed(xml: &str, limit: usize) -> ParsedFeed {
    let total = TOTAL_RE.captures(xml).and_then(|c| c[1].parse::<u64>().ok());
    let mut hits = Vec::new();
    for entry in ENTRY_RE.captures_iter(xml) {
        if hits.len() >= limit {
            break;
        }
        let e = &entry[1];
        let title = TITLE_RE.captures(e).map(|c| decode_entities(&c[1])).unwrap_or_else(|| "(untitled)".to_string());

        let mut neutral_citation: Option<String> = None;
        let mut slug: Option<String> = None;
        for idm in ID_RE.captures_iter(e) {
            let attrs = &idm[1];
            if TYPE_UKNCN_RE.is_match(attrs) {
                let text = decode_entities(&idm[2]);
                if !text.is_empty() {
                    neutral_citation = Some(text);
                }
                if let Some(s) = SLUG_RE.captures(attrs) {
                    slug = Some(s[1].to_string());
                }
            }
        }

        if slug.is_none() {
            for lm in LINK_RE.captures_iter(e) {
                let a = &lm[1];
                if REL_ALT_RE.is_match(a) && !TYPE_ATTR_RE.is_match(a) {
                    if let Some(h) = HREF_RE.captures(a) {
                        let href = &h[1];
                        let prefix = format!("{TNA_BASE}/");
                        if let Some(rest) = href.strip_prefix(&prefix) {
                            slug = Some(rest.trim_end_matches('/').to_string());
                            break;
                        }
                    }
                }
            }
        }

        let court = COURT_RE.captures(e).map(|c| decode_entities(&c[1]));
        let date = PUB_RE.captures(e).map(|c| c[1].trim().chars().take(10).collect::<String>());
        let url = slug.as_ref().map(|s| format!("{TNA_BASE}/{s}"));
        hits.push(CaseLawHit { neutral_citation, title, court, date, slug, url });
    }
    ParsedFeed { hits, total }
}

/// Map an upstream HTTP status to the envelope status + detail.
pub fn status_for_response(code: u16) -> (LookupStatus, String) {
    if code == 404 {
        return (LookupStatus::NotFound, "Find Case Law returned 404.".into());
    }
    if code == 429 {
        return (LookupStatus::UpstreamUnavailable, "Find Case Law rate limit hit — retry shortly.".into());
    }
    if code >= 500 {
        return (LookupStatus::UpstreamUnavailable, format!("Find Case Law returned {code} — try again later."));
    }
    if code >= 400 {
        return (LookupStatus::Error, format!("Find Case Law rejected the request ({code})."));
    }
    (LookupStatus::Ok, String::new())
}

/// Build the envelope from a successful feed body.
pub fn envelope_from_feed(xml: &str, limit: usize) -> SearchEnvelope {
    let ParsedFeed { hits, total } = parse_atom_feed(xml, limit);
    if hits.is_empty() {
        return SearchEnvelope {
            status: LookupStatus::Empty,
            results: vec![],
            detail: Some("No matching judgments in Find Case Law (coverage is ~2003 onward).".into()),
            total,
        };
    }
    SearchEnvelope { status: LookupStatus::Ok, results: hits, detail: None, total }
}

/// The canonical query for a verification request and its cache key.
pub struct VerifyQuery {
    pub citation: String,
    pub case_name: String,
    pub ncn: Option<String>,
    pub query: Option<String>,
    pub cache_key: String,
}

pub fn verify_query(citation: Option<&str>, case_name: Option<&str>) -> VerifyQuery {
    let citation = citation.map(str::trim).unwrap_or("").to_string();
    let case_name = case_name.map(str::trim).unwrap_or("").to_string();
    let ncn = extract_neutral_citation(&citation).or_else(|| extract_neutral_citation(&case_name));
    let cache_key = format!("{}|{}", ncn.clone().unwrap_or_default(), case_name.to_lowercase());
    // `ncn ?? caseName ?? citation` — caseName is a string (never nullish), so
    // an empty caseName still wins over the citation; the JS then treats "" as
    // "no query".
    let query = match &ncn {
        Some(n) => Some(n.clone()),
        None => {
            if case_name.is_empty() {
                None
            } else {
                Some(case_name.clone())
            }
        }
    };
    VerifyQuery { citation, case_name, ncn, query, cache_key }
}

pub fn no_query_result() -> VerifyResult {
    VerifyResult {
        trust_level: TrustLevel::Quarantined,
        reason: "No citation or case name to verify.".into(),
        source: VerifySource::FindCaseLaw,
        matched_title: None,
        matched_citation: None,
        slug: None,
        url: None,
    }
}

/// Decide the verification verdict from a search envelope. Returns
/// `(result, cacheable)` — upstream failures are never cached.
pub fn decide_verification(q: &VerifyQuery, env: &SearchEnvelope) -> (VerifyResult, bool) {
    if matches!(env.status, LookupStatus::UpstreamTimeout | LookupStatus::UpstreamUnavailable | LookupStatus::Error) {
        let detail = env.detail.clone().unwrap_or_else(|| env.status.as_str().to_string());
        return (
            VerifyResult {
                trust_level: TrustLevel::Quarantined,
                reason: format!("Live verification unavailable ({detail})."),
                source: VerifySource::Unavailable,
                matched_title: None,
                matched_citation: None,
                slug: None,
                url: None,
            },
            false,
        );
    }
    if matches!(env.status, LookupStatus::Empty | LookupStatus::NotFound) || env.results.is_empty() {
        let reason = match &q.ncn {
            Some(n) => format!("Neutral citation {n} not found in Find Case Law (note: coverage is ~2003 onward)."),
            None => format!(
                "No Find Case Law match for \"{}\".",
                if !q.case_name.is_empty() { &q.case_name } else { &q.citation }
            ),
        };
        return (
            VerifyResult {
                trust_level: TrustLevel::Quarantined,
                reason,
                source: VerifySource::FindCaseLaw,
                matched_title: None,
                matched_citation: None,
                slug: None,
                url: None,
            },
            true,
        );
    }

    if let Some(ncn) = &q.ncn {
        let wanted = normalise_citation(ncn);
        if let Some(exact) = env
            .results
            .iter()
            .find(|h| h.neutral_citation.as_deref().map(normalise_citation) == Some(wanted.clone()))
        {
            // A matching neutral-citation NUMBER is not sufficient: cross-check
            // the cited party name against the matched title.
            let name_to_check = if !q.case_name.is_empty() {
                q.case_name.clone()
            } else {
                let stripped = match raw_neutral_citation_match(&q.citation) {
                    Some(raw) => q.citation.replacen(raw, " ", 1),
                    None => q.citation.clone(),
                };
                stripped.replace(['[', ']'], " ").trim().to_string()
            };
            let tokens = if name_to_check.is_empty() { vec![] } else { significant_party_tokens(&name_to_check) };
            let title_lc = exact.title.to_lowercase();
            let name_contradicts = !tokens.is_empty() && !tokens.iter().any(|t| title_lc.contains(t.as_str()));
            if name_contradicts {
                return (
                    VerifyResult {
                        trust_level: TrustLevel::Check,
                        reason: format!(
                            "Neutral citation {ncn} exists but resolves to '{}', which does not match the cited party name(s) — likely a mis-citation; verify manually.",
                            exact.title
                        ),
                        source: VerifySource::FindCaseLaw,
                        matched_title: Some(exact.title.clone()),
                        matched_citation: exact.neutral_citation.clone(),
                        slug: exact.slug.clone(),
                        url: exact.url.clone(),
                    },
                    true,
                );
            }
            return (
                VerifyResult {
                    trust_level: TrustLevel::Verified,
                    reason: format!(
                        "Exact neutral-citation match in Find Case Law: {} — {}.",
                        exact.neutral_citation.clone().unwrap_or_default(),
                        exact.title
                    ),
                    source: VerifySource::FindCaseLaw,
                    matched_title: Some(exact.title.clone()),
                    matched_citation: exact.neutral_citation.clone(),
                    slug: exact.slug.clone(),
                    url: exact.url.clone(),
                },
                true,
            );
        }
    }

    // Case-name match but citation not confirmed → CHECK (a nearby candidate).
    let name_key = q.case_name.to_lowercase();
    let name_hit = if !name_key.is_empty() {
        env.results.iter().find(|h| {
            let t = h.title.to_lowercase();
            NAME_SPLIT_RE.split(&name_key).all(|part| part.len() > 2 && t.contains(part))
        })
    } else {
        None
    };
    let hit = name_hit.unwrap_or(&env.results[0]);
    let hit_label = hit.neutral_citation.clone().unwrap_or_else(|| hit.title.clone());
    (
        VerifyResult {
            trust_level: TrustLevel::Check,
            reason: match &q.ncn {
                Some(n) => format!("Citation {n} not confirmed, but a related judgment exists: {hit_label}. Verify manually."),
                None => format!("Possible match in Find Case Law: {hit_label}. Citation not independently confirmed."),
            },
            source: VerifySource::FindCaseLaw,
            matched_title: Some(hit.title.clone()),
            matched_citation: hit.neutral_citation.clone(),
            slug: hit.slug.clone(),
            url: hit.url.clone(),
        },
        true,
    )
}

/// `/\s+v\.?\s+/` (case-sensitive in the TypeScript name-hit branch).
static NAME_SPLIT_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+v\.?\s+").unwrap());

#[cfg(test)]
mod tests {
    use super::*;

    const FEED: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:tna="https://caselaw.nationalarchives.gov.uk">
<entry><title>Essop &amp; Ors v Home Office (UK Border Agency)</title><link href="https://caselaw.nationalarchives.gov.uk/uksc/2017/27" rel="alternate"/><published>2017-04-05T00:00:00+00:00</published><updated>2017-04-05T00:00:00+00:00</updated><author><name>United Kingdom Supreme Court</name></author><tna:identifier slug="uksc/2017/27" type="ukncn">[2017] UKSC 27</tna:identifier></entry>
<entry><title>G Laffy v Wkcic Group T/A Capital City College Group</title><link href="https://caselaw.nationalarchives.gov.uk/eat/2026/90" rel="alternate"/><published>2026-06-19T00:00:00+00:00</published><updated>2026-06-19T09:37:47+00:00</updated><author><name>Employment Appeal Tribunal</name></author><tna:identifier slug="eat/2026/90" type="ukncn">[2026] EAT 90</tna:identifier></entry>
</feed>"#;

    #[test]
    fn parses_feed() {
        let p = parse_atom_feed(FEED, 10);
        assert_eq!(p.hits.len(), 2);
        let e = &p.hits[0];
        assert_eq!(e.neutral_citation.as_deref(), Some("[2017] UKSC 27"));
        assert_eq!(e.slug.as_deref(), Some("uksc/2017/27"));
        assert_eq!(e.court.as_deref(), Some("United Kingdom Supreme Court"));
        assert_eq!(e.date.as_deref(), Some("2017-04-05"));
        assert_eq!(e.url.as_deref(), Some("https://caselaw.nationalarchives.gov.uk/uksc/2017/27"));
        assert!(e.title.contains("Essop & Ors v Home Office"));
        assert_eq!(parse_atom_feed(FEED, 1).hits.len(), 1);
    }

    #[test]
    fn helpers() {
        assert_eq!(extract_neutral_citation("see Essop v Home Office [2017] UKSC 27 at [25]").as_deref(), Some("[2017] UKSC 27"));
        assert_eq!(extract_neutral_citation("no citation here"), None);
        assert_eq!(normalise_citation("[2017] UKSC 27"), normalise_citation("[2017]  uksc 27"));
        assert_eq!(significant_party_tokens("Nonexistent v Fabricated Ltd"), vec!["nonexistent", "fabricated"]);
        assert_eq!(decode_entities(" Smith &#38; Jones &#x26; Co &lt;Ltd&gt; "), "Smith & Jones & Co <Ltd>");
    }

    #[test]
    fn verification_decisions() {
        let env = envelope_from_feed(FEED, 10);
        let q = verify_query(Some("[2017] UKSC 27"), Some("Essop v Home Office"));
        let (r, _) = decide_verification(&q, &env);
        assert_eq!(r.trust_level, TrustLevel::Verified);
        let q = verify_query(Some("[2017] UKSC 999"), Some("Essop v Home Office"));
        assert_eq!(decide_verification(&q, &env).0.trust_level, TrustLevel::Check);
        let q = verify_query(Some("Nonexistent v Fabricated Ltd [2017] UKSC 27"), None);
        let (r, _) = decide_verification(&q, &env);
        assert_eq!(r.trust_level, TrustLevel::Check);
        let q = verify_query(Some("[2017] UKSC 27"), None);
        assert_eq!(decide_verification(&q, &env).0.trust_level, TrustLevel::Verified);
    }
}
