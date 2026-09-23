//! Minimal HTTP client abstraction so every network-touching service can be
//! driven by canned responses in tests (the TypeScript suite stubs
//! `globalThis.fetch` the same way).

use async_trait::async_trait;
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
}

#[derive(Debug, Clone)]
pub struct HttpRequest {
    pub method: Method,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<Vec<u8>>,
    pub timeout: Duration,
    /// `fetch` follows redirects by default; the SSRF-guarded PDF fetch uses
    /// `redirect: "manual"` and re-validates every hop itself.
    pub follow_redirects: bool,
}

impl HttpRequest {
    pub fn get(url: impl Into<String>) -> Self {
        Self { method: Method::Get, url: url.into(), headers: vec![], body: None, timeout: Duration::from_secs(30), follow_redirects: true }
    }
    pub fn post(url: impl Into<String>, body: Vec<u8>) -> Self {
        Self { method: Method::Post, url: url.into(), headers: vec![], body: Some(body), timeout: Duration::from_secs(300), follow_redirects: true }
    }
    pub fn header(mut self, k: &str, v: &str) -> Self {
        self.headers.push((k.to_string(), v.to_string()));
        self
    }
    pub fn timeout(mut self, d: Duration) -> Self {
        self.timeout = d;
        self
    }
    pub fn manual_redirects(mut self) -> Self {
        self.follow_redirects = false;
        self
    }
}

#[derive(Debug, Clone)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl HttpResponse {
    pub fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }
    pub fn header(&self, name: &str) -> Option<&str> {
        let n = name.to_ascii_lowercase();
        self.headers.iter().find(|(k, _)| k.to_ascii_lowercase() == n).map(|(_, v)| v.as_str())
    }
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum HttpError {
    /// The equivalent of an `AbortError` from a timed-out `fetch`.
    #[error("timeout")]
    Timeout,
    #[error("transport error: {0}")]
    Transport(String),
}

#[async_trait]
pub trait HttpClient: Send + Sync {
    async fn send(&self, req: HttpRequest) -> Result<HttpResponse, HttpError>;
}

/// Production client backed by `reqwest` (rustls). Two inner clients: one that
/// follows redirects (TNA, Anthropic, Resend) and one that never does (the
/// SSRF-guarded PDF fetch).
pub struct ReqwestClient {
    following: reqwest::Client,
    manual: reqwest::Client,
}

impl ReqwestClient {
    pub fn new() -> Result<Self, HttpError> {
        let following = reqwest::Client::builder().build().map_err(|e| HttpError::Transport(e.to_string()))?;
        let manual = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| HttpError::Transport(e.to_string()))?;
        Ok(Self { following, manual })
    }
}

#[async_trait]
impl HttpClient for ReqwestClient {
    async fn send(&self, req: HttpRequest) -> Result<HttpResponse, HttpError> {
        let client = if req.follow_redirects { &self.following } else { &self.manual };
        let mut builder = match req.method {
            Method::Get => client.get(&req.url),
            Method::Post => client.post(&req.url),
        };
        for (k, v) in &req.headers {
            builder = builder.header(k, v);
        }
        if let Some(b) = req.body {
            builder = builder.body(b);
        }
        builder = builder.timeout(req.timeout);
        let resp = builder.send().await.map_err(|e| if e.is_timeout() { HttpError::Timeout } else { HttpError::Transport(e.to_string()) })?;
        let status = resp.status().as_u16();
        let headers = resp
            .headers()
            .iter()
            .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
            .collect();
        let body = resp.bytes().await.map_err(|e| if e.is_timeout() { HttpError::Timeout } else { HttpError::Transport(e.to_string()) })?.to_vec();
        Ok(HttpResponse { status, headers, body })
    }
}

/// A client that refuses every request — the safe default for tests that
/// must never touch the network.
pub struct NoNetwork;

#[async_trait]
impl HttpClient for NoNetwork {
    async fn send(&self, req: HttpRequest) -> Result<HttpResponse, HttpError> {
        Err(HttpError::Transport(format!("network disabled (attempted {})", req.url)))
    }
}

type Responder = dyn Fn(&HttpRequest) -> Result<HttpResponse, HttpError> + Send + Sync;

/// Scripted client: a responder closure plus a record of every request made.
pub struct MockHttp {
    responder: Box<Responder>,
    pub calls: Mutex<Vec<HttpRequest>>,
}

impl MockHttp {
    pub fn new(responder: impl Fn(&HttpRequest) -> Result<HttpResponse, HttpError> + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self { responder: Box::new(responder), calls: Mutex::new(vec![]) })
    }
    /// Always answer 200 with a text body.
    pub fn ok_text(body: &str) -> Arc<Self> {
        let b = body.to_string();
        Self::new(move |_| Ok(HttpResponse { status: 200, headers: vec![("content-type".into(), "text/plain".into())], body: b.clone().into_bytes() }))
    }
    pub fn status(code: u16) -> Arc<Self> {
        Self::new(move |_| Ok(HttpResponse { status: code, headers: vec![], body: vec![] }))
    }
    pub fn timeout() -> Arc<Self> {
        Self::new(|_| Err(HttpError::Timeout))
    }
    pub fn transport_error() -> Arc<Self> {
        Self::new(|_| Err(HttpError::Transport("connection refused".into())))
    }
    pub fn urls(&self) -> Vec<String> {
        self.calls.lock().unwrap().iter().map(|r| r.url.clone()).collect()
    }
    pub fn call_count(&self) -> usize {
        self.calls.lock().unwrap().len()
    }
}

#[async_trait]
impl HttpClient for MockHttp {
    async fn send(&self, req: HttpRequest) -> Result<HttpResponse, HttpError> {
        let r = (self.responder)(&req);
        self.calls.lock().unwrap().push(req);
        r
    }
}
