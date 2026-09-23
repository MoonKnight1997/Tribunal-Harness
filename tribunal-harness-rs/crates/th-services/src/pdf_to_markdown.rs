//! PDF → Markdown. Port of `src/services/pdf-to-markdown.ts`. Convert a PDF
//! (in-memory, or from a trusted legal source) to clean text/Markdown so an
//! LLM can reason over it. Fetching is SSRF-hardened: HTTPS only, host
//! allowlist, manual redirects re-validated per hop, size caps.
//!
//! Text extraction uses the pure-Rust `pdf-extract` crate; its output differs
//! from pdf.js in whitespace and line breaks (see PARITY.md).

use crate::http::{HttpClient, HttpError, HttpRequest};
use serde::Serialize;
use std::time::Duration;

const ALLOWED_HOSTS: [&str; 5] = ["caselaw.nationalarchives.gov.uk", "assets.caselaw.nationalarchives.gov.uk", "www.bailii.org", "www.legislation.gov.uk", "www.gov.uk"];

const MAX_PDF_BYTES: usize = 20 * 1024 * 1024; // 20 MB
const DEFAULT_TIMEOUT_MS: u64 = 20_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PdfStatus {
    Ok,
    Empty,
    TooLarge,
    NotPdf,
    ForbiddenHost,
    UpstreamTimeout,
    UpstreamUnavailable,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfMarkdownResult {
    pub status: PdfStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub markdown: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pages: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
}

impl PdfMarkdownResult {
    fn err(status: PdfStatus, detail: impl Into<String>) -> Self {
        Self { status, markdown: None, pages: None, detail: Some(detail.into()), source_url: None }
    }
    fn with_source(mut self, url: &str) -> Self {
        self.source_url = Some(url.to_string());
        self
    }
}

/// Light text → Markdown tidy: normalise newlines, drop trailing spaces,
/// collapse blank runs.
pub fn tidy_to_markdown(text: &str) -> String {
    let no_cr = text.replace('\r', "");
    // /[ \t]+\n/g → "\n"
    let mut s = String::with_capacity(no_cr.len());
    let mut pending_ws = String::new();
    for ch in no_cr.chars() {
        match ch {
            ' ' | '\t' => pending_ws.push(ch),
            '\n' => {
                pending_ws.clear();
                s.push('\n');
            }
            _ => {
                s.push_str(&pending_ws);
                pending_ws.clear();
                s.push(ch);
            }
        }
    }
    s.push_str(&pending_ws);
    // /\n{3,}/g → "\n\n"
    let mut out = String::with_capacity(s.len());
    let mut run = 0;
    for ch in s.chars() {
        if ch == '\n' {
            run += 1;
            if run <= 2 {
                out.push('\n');
            }
        } else {
            run = 0;
            out.push(ch);
        }
    }
    out.trim().to_string()
}

/// True if the buffer starts with the `%PDF-` magic header.
pub fn looks_like_pdf(buffer: &[u8]) -> bool {
    buffer.len() >= 5 && &buffer[..5] == b"%PDF-"
}

/// Raw text of a PDF (what `pdf-parse`'s `data.text` is to the TypeScript
/// triage route). Panics inside the extractor are contained and reported as
/// errors, like a thrown JS error would be caught.
pub fn pdf_raw_text(buffer: &[u8]) -> Result<String, String> {
    match std::panic::catch_unwind(|| pdf_extract::extract_text_from_mem(buffer)) {
        Ok(Ok(text)) => Ok(text),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err("extractor panicked on malformed input".to_string()),
    }
}

/// Convert an in-memory PDF to Markdown. Never fails (errors become a status).
pub fn pdf_buffer_to_markdown(buffer: &[u8]) -> PdfMarkdownResult {
    if buffer.is_empty() {
        return PdfMarkdownResult::err(PdfStatus::Empty, "Empty buffer.");
    }
    if !looks_like_pdf(buffer) {
        return PdfMarkdownResult::err(PdfStatus::NotPdf, "Not a PDF (missing %PDF- header).");
    }
    // pdf-extract panics on some malformed inputs; contain that like a thrown
    // JS error would be caught.
    let extracted = std::panic::catch_unwind(|| pdf_extract::extract_text_from_mem(buffer));
    let pages = std::panic::catch_unwind(|| lopdf::Document::load_mem(buffer).ok().map(|d| d.get_pages().len() as u64)).ok().flatten();
    match extracted {
        Ok(Ok(text)) => {
            let md = tidy_to_markdown(&text);
            if md.is_empty() {
                return PdfMarkdownResult {
                    status: PdfStatus::Empty,
                    markdown: None,
                    pages,
                    detail: Some("No extractable text — the PDF is likely scanned/image-only (would need OCR).".into()),
                    source_url: None,
                };
            }
            PdfMarkdownResult { status: PdfStatus::Ok, markdown: Some(md), pages, detail: None, source_url: None }
        }
        Ok(Err(e)) => PdfMarkdownResult::err(PdfStatus::Error, format!("PDF parse failed: {e}")),
        Err(_) => PdfMarkdownResult::err(PdfStatus::Error, "PDF parse failed: extractor panicked on malformed input"),
    }
}

/// Parse a URL just enough for the SSRF guard: scheme and hostname (lowercased,
/// port/userinfo stripped), like the WHATWG `URL` class.
fn parse_scheme_host(url: &str) -> Option<(String, String)> {
    let (scheme, rest) = url.split_once("://")?;
    if scheme.is_empty() || !scheme.chars().all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '-' || c == '.') {
        return None;
    }
    let authority = rest.split(['/', '?', '#']).next()?;
    let hostport = authority.rsplit('@').next()?;
    let host = hostport.split(':').next()?;
    if host.is_empty() {
        return None;
    }
    Some((scheme.to_ascii_lowercase(), host.to_ascii_lowercase()))
}

/// Whether a URL is an allowlisted, https legal source (SSRF guard).
pub fn is_allowed_pdf_url(url: &str) -> bool {
    match parse_scheme_host(url) {
        Some((scheme, host)) => scheme == "https" && ALLOWED_HOSTS.contains(&host.as_str()),
        None => false,
    }
}

/// Resolve `location` against `base` (absolute, or path-absolute/relative).
fn resolve_location(base: &str, location: &str) -> String {
    if location.contains("://") {
        return location.to_string();
    }
    let (scheme, rest) = match base.split_once("://") {
        Some(p) => p,
        None => return location.to_string(),
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let origin = format!("{scheme}://{authority}");
    if let Some(p) = location.strip_prefix("//") {
        return format!("{scheme}://{p}");
    }
    if location.starts_with('/') {
        return format!("{origin}{location}");
    }
    let path = &rest[authority.len()..];
    let path = path.split(['?', '#']).next().unwrap_or("/");
    let dir = match path.rfind('/') {
        Some(i) => &path[..=i],
        None => "/",
    };
    format!("{origin}{dir}{location}")
}

/// Fetch a PDF from a trusted legal source and convert it to Markdown. Never
/// fails; rejects non-allowlisted hosts (incl. redirect targets) and oversized
/// payloads.
pub async fn fetch_pdf_as_markdown(http: &dyn HttpClient, url: &str, timeout_ms: Option<u64>) -> PdfMarkdownResult {
    if parse_scheme_host(url).is_none() {
        return PdfMarkdownResult::err(PdfStatus::Error, "Invalid URL.").with_source(url);
    }
    if !is_allowed_pdf_url(url) {
        return PdfMarkdownResult::err(
            PdfStatus::ForbiddenHost,
            format!("Refusing to fetch: only https PDFs from trusted legal sources are allowed ({}).", ALLOWED_HOSTS.join(", ")),
        )
        .with_source(url);
    }
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS));
    let request = |u: &str| HttpRequest::get(u).header("User-Agent", "tribunal-harness/1.0").header("Accept", "application/pdf").timeout(timeout).manual_redirects();

    let mut current = url.to_string();
    let mut resp = match http.send(request(&current)).await {
        Ok(r) => r,
        Err(HttpError::Timeout) => return PdfMarkdownResult::err(PdfStatus::UpstreamTimeout, "Fetch timed out.").with_source(url),
        Err(HttpError::Transport(_)) => return PdfMarkdownResult::err(PdfStatus::UpstreamUnavailable, "Could not fetch the PDF.").with_source(url),
    };
    let mut hops = 0;
    while (300..400).contains(&resp.status) {
        hops += 1;
        if hops > 5 {
            return PdfMarkdownResult::err(PdfStatus::Error, "Too many redirects.").with_source(url);
        }
        let Some(location) = resp.header("location") else {
            return PdfMarkdownResult::err(PdfStatus::Error, "Redirect without a Location header.").with_source(url);
        };
        let next = resolve_location(&current, location);
        if !is_allowed_pdf_url(&next) {
            return PdfMarkdownResult::err(PdfStatus::ForbiddenHost, "Refusing to follow redirect to a non-allowlisted host (SSRF guard).").with_source(url);
        }
        current = next;
        resp = match http.send(request(&current)).await {
            Ok(r) => r,
            Err(HttpError::Timeout) => return PdfMarkdownResult::err(PdfStatus::UpstreamTimeout, "Fetch timed out.").with_source(url),
            Err(HttpError::Transport(_)) => return PdfMarkdownResult::err(PdfStatus::UpstreamUnavailable, "Could not fetch the PDF.").with_source(url),
        };
    }
    if !resp.ok() {
        if resp.status >= 500 || resp.status == 429 {
            return PdfMarkdownResult::err(PdfStatus::UpstreamUnavailable, format!("Source returned {}.", resp.status)).with_source(url);
        }
        return PdfMarkdownResult::err(PdfStatus::Error, format!("Source returned {}.", resp.status)).with_source(url);
    }
    let declared = resp.header("content-length").and_then(th_core::jsnum::js_parse_int).unwrap_or(0);
    if declared > 0 && declared as usize > MAX_PDF_BYTES {
        return PdfMarkdownResult::err(PdfStatus::TooLarge, format!("PDF too large ({declared} bytes).")).with_source(url);
    }
    if resp.body.len() > MAX_PDF_BYTES {
        return PdfMarkdownResult::err(PdfStatus::TooLarge, format!("PDF too large ({} bytes).", resp.body.len())).with_source(url);
    }
    pdf_buffer_to_markdown(&resp.body).with_source(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helpers() {
        assert_eq!(tidy_to_markdown("a\r\n\n\n\nb   \n"), "a\n\nb");
        assert!(looks_like_pdf(b"%PDF-1.7"));
        assert!(!looks_like_pdf(b"not a pdf"));
        assert!(is_allowed_pdf_url("https://caselaw.nationalarchives.gov.uk/eat/2026/90/data.pdf"));
        assert!(!is_allowed_pdf_url("http://caselaw.nationalarchives.gov.uk/x.pdf"));
        assert!(!is_allowed_pdf_url("https://169.254.169.254/latest/meta-data"));
        assert!(!is_allowed_pdf_url("not a url"));
        assert!(is_allowed_pdf_url("https://WWW.BAILII.ORG/x.pdf"));
        assert!(is_allowed_pdf_url("https://user:pw@www.bailii.org/x.pdf"));
        assert_eq!(resolve_location("https://caselaw.nationalarchives.gov.uk/redirect.pdf", "/relative/final.pdf"), "https://caselaw.nationalarchives.gov.uk/relative/final.pdf");
        assert_eq!(pdf_buffer_to_markdown(b"").status, PdfStatus::Empty);
        assert_eq!(pdf_buffer_to_markdown(b"hello").status, PdfStatus::NotPdf);
    }
}
