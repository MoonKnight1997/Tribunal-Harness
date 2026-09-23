//! Helpers for driving the router in-process (tests and the smoke harness):
//! request builders, multipart encoding and a `oneshot` call that returns the
//! status and body.

use axum::body::Body;
use axum::http::{header, HeaderMap, Method, Request};
use axum::Router;
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

pub struct MultipartPart {
    pub name: String,
    pub filename: Option<String>,
    pub content_type: Option<String>,
    pub data: Vec<u8>,
}

impl MultipartPart {
    pub fn file(name: &str, filename: &str, content_type: &str, data: impl Into<Vec<u8>>) -> Self {
        Self { name: name.into(), filename: Some(filename.into()), content_type: Some(content_type.into()), data: data.into() }
    }
    pub fn text(name: &str, value: &str) -> Self {
        Self { name: name.into(), filename: None, content_type: None, data: value.as_bytes().to_vec() }
    }
}

pub const BOUNDARY: &str = "----TribunalHarnessBoundary7MA4YWxkTrZu0gW";

/// Encode `multipart/form-data` the way `fetch` does for a `FormData` body.
pub fn multipart_body(parts: &[MultipartPart]) -> Vec<u8> {
    let mut out = Vec::new();
    for p in parts {
        out.extend_from_slice(format!("--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"{}\"", p.name).as_bytes());
        if let Some(f) = &p.filename {
            out.extend_from_slice(format!("; filename=\"{f}\"").as_bytes());
        }
        out.extend_from_slice(b"\r\n");
        if let Some(ct) = &p.content_type {
            out.extend_from_slice(format!("Content-Type: {ct}\r\n").as_bytes());
        }
        out.extend_from_slice(b"\r\n");
        out.extend_from_slice(&p.data);
        out.extend_from_slice(b"\r\n");
    }
    out.extend_from_slice(format!("--{BOUNDARY}--\r\n").as_bytes());
    out
}

pub fn multipart_content_type() -> String {
    format!("multipart/form-data; boundary={BOUNDARY}")
}

pub fn get(uri: &str) -> Request<Body> {
    Request::builder().method(Method::GET).uri(uri).body(Body::empty()).unwrap()
}

pub fn post_json(uri: &str, body: &Value, extra_headers: &[(&str, &str)]) -> Request<Body> {
    post_raw(uri, serde_json::to_vec(body).unwrap(), "application/json", extra_headers)
}

pub fn post_raw(uri: &str, body: impl Into<Body>, content_type: &str, extra_headers: &[(&str, &str)]) -> Request<Body> {
    let mut b = Request::builder().method(Method::POST).uri(uri).header(header::CONTENT_TYPE, content_type);
    for (k, v) in extra_headers {
        b = b.header(*k, *v);
    }
    b.body(body.into()).unwrap()
}

pub fn post_multipart(uri: &str, parts: &[MultipartPart]) -> Request<Body> {
    post_raw(uri, multipart_body(parts), &multipart_content_type(), &[])
}

pub struct Captured {
    pub status: u16,
    pub headers: HeaderMap,
    pub body: Vec<u8>,
}

impl Captured {
    pub fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or_else(|e| panic!("response is not JSON ({e}): {}", String::from_utf8_lossy(&self.body)))
    }
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).and_then(|v| v.to_str().ok())
    }
}

/// Drive one request through the router without a network listener.
pub async fn call(app: &Router, req: Request<Body>) -> Captured {
    let resp = app.clone().oneshot(req).await.expect("router call");
    let status = resp.status().as_u16();
    let headers = resp.headers().clone();
    let body = resp.into_body().collect().await.expect("body").to_bytes().to_vec();
    Captured { status, headers, body }
}
