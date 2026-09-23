//! Tribunal Harness — async I/O services. Every network call goes through the
//! [`http::HttpClient`] trait so the whole crate is testable with canned
//! responses and never touches the network in `cargo test`.

pub mod anthropic;
pub mod citation_authority;
pub mod claude_client;
pub mod debate;
pub mod docx;
pub mod http;
pub mod pdf_to_markdown;
pub mod refinement;
pub mod request_access;
pub mod tna;
