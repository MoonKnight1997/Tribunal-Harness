//! Find Case Law — live UK case-law retrieval & verification against The
//! National Archives (`caselaw.nationalarchives.gov.uk`). Port of the I/O
//! half of `src/services/find-case-law.ts`; the parsing and verdict logic is
//! in `th_core::find_case_law`.

use crate::http::{HttpClient, HttpError, HttpRequest};
use crate::pdf_to_markdown::{fetch_pdf_as_markdown, PdfStatus};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use th_core::dates::Clock;
use th_core::find_case_law::*;

const VERIFY_TTL_MS: i64 = 60 * 60 * 1000;

#[derive(Debug, Clone, Default)]
pub struct SearchOptions {
    pub query: String,
    /// Court slug filter, e.g. "eat", "uksc", "ewca/civ".
    pub court: Option<String>,
    pub party: Option<String>,
    pub limit: Option<usize>,
    pub page: Option<u32>,
    pub timeout_ms: Option<u64>,
}

/// Percent-encode like `URLSearchParams` (`application/x-www-form-urlencoded`).
fn form_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'*' | b'-' | b'.' | b'_' => out.push(b as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

pub struct TnaClient {
    http: Arc<dyn HttpClient>,
    clock: Arc<dyn Clock>,
    cache: Mutex<HashMap<String, (i64, VerifyResult)>>,
}

impl TnaClient {
    pub fn new(http: Arc<dyn HttpClient>, clock: Arc<dyn Clock>) -> Self {
        Self { http, clock, cache: Mutex::new(HashMap::new()) }
    }

    /// Test-only: clear the verification cache.
    pub fn clear_verify_cache(&self) {
        self.cache.lock().unwrap().clear();
    }

    async fn fetch_atom(&self, params: &[(&str, &str)], timeout_ms: u64) -> Result<crate::http::HttpResponse, HttpError> {
        let qs = params.iter().map(|(k, v)| format!("{}={}", form_encode(k), form_encode(v))).collect::<Vec<_>>().join("&");
        let req = HttpRequest::get(format!("{TNA_BASE}/atom.xml?{qs}"))
            .header("User-Agent", USER_AGENT)
            .header("Accept", "application/atom+xml,application/xml")
            .timeout(Duration::from_millis(timeout_ms));
        self.http.send(req).await
    }

    /// Search UK case law live. Never fails: statuses distinguish
    /// ok / empty / not_found / upstream_* / error.
    pub async fn search_case_law(&self, opts: &SearchOptions) -> SearchEnvelope {
        let limit = opts.limit.unwrap_or(10).clamp(1, 50);
        let page = opts.page.unwrap_or(1).to_string();
        let mut params: Vec<(&str, &str)> = vec![("query", opts.query.as_str()), ("page", page.as_str())];
        if let Some(c) = &opts.court {
            params.push(("court", c.as_str()));
        }
        if let Some(p) = &opts.party {
            params.push(("party", p.as_str()));
        }
        match self.fetch_atom(&params, opts.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS)).await {
            Ok(resp) => {
                if !resp.ok() {
                    let (status, detail) = status_for_response(resp.status);
                    return SearchEnvelope { status, results: vec![], detail: Some(detail), total: None };
                }
                envelope_from_feed(&resp.text(), limit)
            }
            Err(HttpError::Timeout) => {
                SearchEnvelope { status: LookupStatus::UpstreamTimeout, results: vec![], detail: Some("Find Case Law timed out — it may be slow; retry.".into()), total: None }
            }
            Err(HttpError::Transport(_)) => {
                SearchEnvelope { status: LookupStatus::UpstreamUnavailable, results: vec![], detail: Some("Could not reach Find Case Law.".into()), total: None }
            }
        }
    }

    /// Double-check a single authority against Find Case Law (1-hour cache).
    pub async fn verify_citation(&self, citation: Option<&str>, case_name: Option<&str>) -> VerifyResult {
        let q = verify_query(citation, case_name);
        let now = self.clock.now_epoch_ms();
        if let Some((at, r)) = self.cache.lock().unwrap().get(&q.cache_key) {
            if now - at < VERIFY_TTL_MS {
                return r.clone();
            }
        }
        let Some(query) = q.query.clone() else {
            return no_query_result();
        };
        let env = self.search_case_law(&SearchOptions { query, limit: Some(10), ..Default::default() }).await;
        let (result, cacheable) = decide_verification(&q, &env);
        if cacheable {
            self.cache.lock().unwrap().insert(q.cache_key, (self.clock.now_epoch_ms(), result.clone()));
        }
        result
    }

    /// Fetch a found judgment as Markdown (TNA serves the PDF at `/<slug>/data.pdf`).
    pub async fn get_judgment_markdown(&self, slug: &str) -> JudgmentMarkdown {
        let clean = slug.trim_matches('/');
        let source_url = format!("{TNA_BASE}/{clean}/data.pdf");
        if clean.is_empty() {
            return JudgmentMarkdown { slug: slug.to_string(), status: PdfStatus::Error, markdown: None, pages: None, source_url, detail: Some("Empty judgment slug.".into()) };
        }
        let res = fetch_pdf_as_markdown(self.http.as_ref(), &source_url, None).await;
        JudgmentMarkdown { slug: clean.to_string(), status: res.status, markdown: res.markdown, pages: res.pages, source_url, detail: res.detail }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JudgmentMarkdown {
    pub slug: String,
    pub status: PdfStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub markdown: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pages: Option<u64>,
    pub source_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http::MockHttp;
    use th_core::dates::FixedClock;
    use th_core::types::TrustLevel;

    const FEED: &str = r#"<feed xmlns:tna="https://caselaw.nationalarchives.gov.uk"><entry><title>Essop v Home Office</title><link href="https://caselaw.nationalarchives.gov.uk/uksc/2017/27" rel="alternate"/><published>2017-04-05T00:00:00+00:00</published><author><name>United Kingdom Supreme Court</name></author><tna:identifier slug="uksc/2017/27" type="ukncn">[2017] UKSC 27</tna:identifier></entry></feed>"#;

    #[tokio::test]
    async fn search_builds_the_query_and_maps_statuses() {
        let http = MockHttp::ok_text(FEED);
        let tna = TnaClient::new(http.clone(), Arc::new(FixedClock(0)));
        let env = tna.search_case_law(&SearchOptions { query: "unfair dismissal".into(), court: Some("eat".into()), ..Default::default() }).await;
        assert_eq!(env.status, LookupStatus::Ok);
        assert_eq!(http.urls()[0], "https://caselaw.nationalarchives.gov.uk/atom.xml?query=unfair+dismissal&page=1&court=eat");
        let tna = TnaClient::new(MockHttp::status(503), Arc::new(FixedClock(0)));
        assert_eq!(tna.search_case_law(&SearchOptions { query: "x".into(), ..Default::default() }).await.status, LookupStatus::UpstreamUnavailable);
        let tna = TnaClient::new(MockHttp::timeout(), Arc::new(FixedClock(0)));
        assert_eq!(tna.search_case_law(&SearchOptions { query: "x".into(), ..Default::default() }).await.status, LookupStatus::UpstreamTimeout);
    }

    #[tokio::test]
    async fn verify_caches_and_never_falsely_verifies() {
        let http = MockHttp::ok_text(FEED);
        let tna = TnaClient::new(http.clone(), Arc::new(FixedClock(0)));
        let r = tna.verify_citation(Some("[2017] UKSC 27"), Some("Essop v Home Office")).await;
        assert_eq!(r.trust_level, TrustLevel::Verified);
        let r2 = tna.verify_citation(Some("[2017] UKSC 27"), Some("Essop v Home Office")).await;
        assert_eq!(r2, r);
        assert_eq!(http.call_count(), 1);
        let tna = TnaClient::new(MockHttp::timeout(), Arc::new(FixedClock(0)));
        let r = tna.verify_citation(Some("[2017] UKSC 27"), Some("Essop v Home Office")).await;
        assert_eq!(r.source, VerifySource::Unavailable);
        assert_eq!(r.trust_level, TrustLevel::Quarantined);
    }
}
