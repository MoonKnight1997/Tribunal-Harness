//! One module per interactive page, plus grouped static pages.

pub mod adversarial_debate;
pub mod analysis_engine;
pub mod case_law_db;
pub mod home;
pub mod institutional;
pub mod legal;
pub mod request_access;
pub mod schema_builder;

use maud::{html, Markup};

/// The `PURPLE LABEL → serif h1` opening most pages share.
pub fn page_intro(label: &str, title: &str) -> Markup {
    html! {
        span class="text-subhead" { (label) }
        h1 style="font-family:var(--font-serif);font-size:3rem;margin-bottom:1.5rem" { (title) }
    }
}

/// The mono, centred, 60 %-opacity disclaimer paragraph most pages end with.
pub fn mono_note(margin_top: &str, text: Markup) -> Markup {
    html! {
        p style=(format!("font-family:var(--font-mono);font-size:0.7rem;color:var(--color-text-secondary);margin-top:{margin_top};text-align:center;opacity:0.6")) { (text) }
    }
}
