//! Tribunal Harness — HTTP API (Axum) and server-rendered UI (maud), plus the
//! hermetic smoke harness. Route behaviour, payload shapes and wording are a
//! port of the Next.js app's `src/app/api/**/route.ts` files.

pub mod app;
pub mod config;
pub mod jsval;
pub mod query;
pub mod routes;
pub mod smoke;
pub mod state;
pub mod testkit;
pub mod ui;

pub use app::router;
pub use config::AppConfig;
pub use state::{AppState, SharedState};
