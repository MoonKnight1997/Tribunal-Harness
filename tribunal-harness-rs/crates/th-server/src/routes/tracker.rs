//! `GET /api/era-2025/tracker`.

use super::json_response;
use axum::response::Response;
use serde_json::json;
use th_core::tracker::tracker_data;

pub async fn get_tracker() -> Response {
    json_response(200, json!({ "changes": tracker_data() }))
}
