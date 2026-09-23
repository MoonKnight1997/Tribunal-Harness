//! Root layout (`src/app/layout.tsx`), NavBar and Footer.

use crate::state::AppState;
use maud::{html, Markup, PreEscaped, DOCTYPE};

pub const ROOT_TITLE: &str = "Tribunal Harness | Structured Legal Analysis";
pub const ROOT_DESCRIPTION: &str = "Structured case analysis for UK employment tribunal litigants-in-person. Turn complex facts into durable legal arguments.";
const KEYWORDS: [&str; 7] = ["employment tribunal", "litigant in person", "UK employment law", "ERA 2025", "legal analysis", "unfair dismissal", "discrimination"];

/// `next/font/google` injected these as CSS variables on `<html>`.
const FONT_VARS: &str = "--font-serif:'Playfair Display', serif;--font-sans:'Outfit', sans-serif;--font-mono:'Fira Code', monospace";

pub struct PageMeta {
    pub title: &'static str,
    pub description: &'static str,
    /// `usePathname()` — drives the active nav link.
    pub path: &'static str,
}

impl PageMeta {
    /// Pages without their own `metadata` export inherit the root layout's.
    pub const fn root(path: &'static str) -> Self {
        Self { title: ROOT_TITLE, description: ROOT_DESCRIPTION, path }
    }
}

const NAV_LINKS: [(&str, &str); 5] = [("/how-it-works", "How It Works"), ("/analysis-engine", "Analysis"), ("/documentation", "Docs"), ("/pricing", "Pricing"), ("/about", "About")];
const TRUST_LINKS: [(&str, &str); 3] = [("/security", "Security"), ("/ethics", "Ethics"), ("/methodology", "Methodology")];
const PLATFORM_LINKS: [(&str, &str); 6] = [
    ("/how-it-works", "How It Works"),
    ("/analysis-engine", "Analysis Engine"),
    ("/adversarial-debate", "Adversarial Debate"),
    ("/product", "Architecture"),
    ("/case-law-db", "Case Law DB"),
    ("/pricing", "Pricing"),
];
const COMPANY_LINKS: [(&str, &str); 4] = [("/about", "About"), ("/methodology", "Methodology"), ("/ethics", "Ethics"), ("/contact", "Contact")];
const LEGAL_LINKS: [(&str, &str); 3] = [("/privacy", "Privacy Policy"), ("/terms", "Terms of Use"), ("/security", "Security")];

/// `<NavBar />` — sticky Liquid Glass nav with the Trust dropdown and the
/// mobile hamburger menu (state toggled by `scripts::GLOBAL`).
pub fn nav(pathname: &str) -> Markup {
    let link_color = |href: &str| if pathname == href { "var(--color-accent-purple)" } else { "rgba(255,255,255,0.8)" };
    html! {
        nav class="sticky top-4 z-50 mx-4 md:mx-auto max-w-7xl" {
            div class="glass-surface glass-thick flex items-center justify-between px-6 py-4" {
                a href="/" class="font-serif text-2xl text-white hover:text-purple-400 transition-colors glass-text" { "Tribunal Harness" }

                div class="hidden md:flex items-center gap-8" {
                    @for (href, label) in NAV_LINKS {
                        a href=(href) class=(format!("text-sm font-medium transition-colors glass-text {}", if pathname == href { "text-purple-400" } else { "text-gray-300 hover:text-purple-400" })) { (label) }
                    }
                    div id="trust-menu" style="position:relative" {
                        button type="button" id="trust-toggle" class="text-sm font-medium transition-colors text-gray-300 hover:text-purple-400 glass-text" style="background:none;border:none;cursor:pointer;display:flex;align-items:center;gap:4px" aria-haspopup="true" aria-controls="trust-dropdown" aria-expanded="false" {
                            "Trust"
                            svg class="trust-caret" width="10" height="6" viewBox="0 0 10 6" fill="currentColor" style="opacity:0.8;transition:transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)" { path d="M0 0l5 6 5-6z" {} }
                        }
                        div id="trust-dropdown" class="glass-surface glass-medium" style="position:absolute;top:calc(100% + 12px);left:50%;transform:translateX(-50%);min-width:160px;z-index:100;transform-origin:top center;transition:all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)" {
                            div style="padding:0.5rem;display:flex;flex-direction:column;gap:2px" {
                                @for (href, label) in TRUST_LINKS {
                                    a href=(href) class="glass-text trust-link" style=(format!("display:block;padding:0.6rem 0.75rem;font-size:0.85rem;color:{};border-radius:8px;transition:background 0.2s, color 0.2s", link_color(href))) { (label) }
                                }
                            }
                        }
                    }
                }

                div class="flex items-center gap-6" {
                    a href="/blog" class="hidden md:block text-gray-300 hover:text-purple-400 transition-colors text-sm font-medium glass-text" { "Blog" }
                    a href="/request-access" class="glass-button glass-thin hidden md:block" style="padding:0.5rem 1.25rem;font-size:0.85rem;border-radius:8px;background:rgba(139,92,246,0.2)" { "Request Access" }
                    button type="button" id="mobile-menu-toggle" class="md:hidden glass-button glass-thin" aria-label="Open menu" aria-controls="mobile-menu" aria-expanded="false" style="padding:6px 8px;color:white;background:rgba(255,255,255,0.05)" {
                        svg id="menu-icon-open" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5))" {
                            line x1="4" y1="6" x2="20" y2="6" {} line x1="4" y1="12" x2="20" y2="12" {} line x1="4" y1="18" x2="20" y2="18" {}
                        }
                        svg id="menu-icon-close" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5))" hidden {
                            line x1="18" y1="6" x2="6" y2="18" {} line x1="6" y1="6" x2="18" y2="18" {}
                        }
                    }
                }
            }

            div id="mobile-menu" class="glass-surface glass-thick md:hidden" style="position:absolute;top:calc(100% + 12px);left:0;right:0;flex-direction:column;padding:2rem 1.5rem;gap:0;transform-origin:top center;animation:pourDown 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)" {
                @for (href, label) in NAV_LINKS {
                    a href=(href) class="glass-text" style=(format!("padding:1rem 0;font-size:1.1rem;color:{};border-bottom:1px solid rgba(255,255,255,0.08);display:block", if pathname == href { "var(--color-accent-purple)" } else { "#fff" })) { (label) }
                }
                div style="padding:1rem 0;border-bottom:1px solid rgba(255,255,255,0.08)" {
                    p class="glass-text" style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.15em;color:rgba(255,255,255,0.5);margin-bottom:0.75rem" { "Trust Indicators" }
                    @for (href, label) in TRUST_LINKS {
                        a href=(href) class="glass-text" style=(format!("display:block;padding:0.5rem 0;font-size:1rem;color:{}", link_color(href))) { (label) }
                    }
                }
                a href="/blog" class="glass-text" style="padding:1rem 0;font-size:1.1rem;color:#fff;border-bottom:1px solid rgba(255,255,255,0.08);display:block" { "Blog" }
                a href="/request-access" class="glass-button glass-medium" style="margin-top:2.5rem;text-align:center;display:block;padding:1rem;background:rgba(139,92,246,0.2)" { "Request Access" }
            }
        }
    }
}

/// `<Footer />` — cream footer with the legal-information disclaimer.
pub fn footer(year: i32) -> Markup {
    let column = |head: &str, links: &[(&str, &str)]| {
        html! {
            div {
                h5 class="footer-col-head" style="color:var(--color-text-dark)" { (head) }
                ul class="footer-list" {
                    @for (href, label) in links { li { a href=(href) style="color:var(--color-text-dark)" { (label) } } }
                }
            }
        }
    };
    html! {
        footer class="site-footer" {
            div class="footer-content" {
                div {
                    h2 class="footer-heading" style="color:var(--color-text-dark)" { "Legal work," br; "structured." }
                    p style="max-width:300px;opacity:0.7;font-size:0.9rem;color:var(--color-text-dark)" { "Empowering litigants-in-person to present their best case with structured, verifiable analysis." }
                }
                div class="footer-links" {
                    (column("Platform", &PLATFORM_LINKS))
                    (column("Company", &COMPANY_LINKS))
                    (column("Legal", &LEGAL_LINKS))
                }
            }
            div style="padding:1.5rem 2rem;border-top:1px solid rgba(26, 26, 26, 0.15);text-align:center" {
                p style="font-family:var(--font-mono);font-size:0.65rem;color:var(--color-text-dark);opacity:0.5;line-height:1.6" {
                    "Tribunal Harness provides legal information, not legal advice. It does not create a solicitor-client relationship. © " (year) " Tribunal Harness."
                }
            }
            div class="brand-huge" style="color:var(--color-text-dark);opacity:0.05" { "Tribunal Harness" }
        }
    }
}

/// The root layout: `<html lang="en">` with the font variables, NavBar,
/// `<main>{children}</main>`, Footer, then the global and page scripts.
pub fn document(state: &AppState, meta: &PageMeta, body: Markup, page_script: Option<&'static str>) -> Markup {
    let year: i32 = state.today().to_iso()[..4].parse().unwrap_or(2026);
    html! {
        (DOCTYPE)
        html lang="en" style=(FONT_VARS) {
            head {
                meta charset="utf-8";
                meta name="viewport" content="width=device-width, initial-scale=1";
                title { (meta.title) }
                meta name="description" content=(meta.description);
                meta name="keywords" content=(KEYWORDS.join(","));
                link rel="stylesheet" href="/static/fonts.css";
                link rel="stylesheet" href="/static/app.css";
            }
            body {
                (nav(meta.path))
                main { (body) }
                (footer(year))
                script { (PreEscaped(crate::ui::scripts::GLOBAL)) }
                @if let Some(s) = page_script { script { (PreEscaped(s)) } }
            }
        }
    }
}

/// Next's default not-found document.
pub fn not_found_page() -> Markup {
    html! {
        (DOCTYPE)
        html lang="en" {
            head {
                meta charset="utf-8";
                meta name="viewport" content="width=device-width, initial-scale=1";
                title { "404: This page could not be found." }
                title { (ROOT_TITLE) }
            }
            body style="font-family:system-ui,sans-serif;background:#000;color:#fff;height:100vh;display:flex;align-items:center;justify-content:center;margin:0" {
                div style="display:flex;align-items:center;gap:20px" {
                    h1 style="font-size:24px;font-weight:500;margin:0;padding-right:23px;border-right:1px solid rgba(255,255,255,.3)" { "404" }
                    h2 style="font-size:14px;font-weight:400;margin:0" { "This page could not be found." }
                }
            }
        }
    }
}
