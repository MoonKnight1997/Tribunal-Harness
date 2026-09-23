//! UI parity against the captured Next.js pages (`fixtures/pages/*.html`).
//! The React and maud markup differ structurally, so the check is on the
//! user-visible content: `<title>`, meta description, every heading and
//! every text node of the captured `<main>` must appear in the Rust page;
//! the light-theme wrapper and the LSA 2007 disclaimer must match too.

mod common;

use common::*;
use regex::Regex;
use serde_json::{json, Value};
use std::sync::LazyLock;
use th_server::testkit::{call, get, post_json, post_raw};
use th_services::http::MockHttp;

static TAG_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]+>").unwrap());
static HEADING_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<h[1-6][^>]*>(.*?)</h[1-6]>").unwrap());
static ENTITY_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp|rsquo|lsquo|ldquo|rdquo|mdash|ndash|copy);").unwrap());
static SCRIPT_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<(script|style|template)[^>]*>.*?</(script|style|template)>").unwrap());

fn decode_entities(s: &str) -> String {
    ENTITY_RE
        .replace_all(s, |c: &regex::Captures| {
            let e = &c[1];
            match e {
                "amp" => "&".to_string(),
                "lt" => "<".to_string(),
                "gt" => ">".to_string(),
                "quot" => "\"".to_string(),
                "apos" => "'".to_string(),
                "nbsp" => " ".to_string(),
                "rsquo" => "’".to_string(),
                "lsquo" => "‘".to_string(),
                "ldquo" => "“".to_string(),
                "rdquo" => "”".to_string(),
                "mdash" => "—".to_string(),
                "ndash" => "–".to_string(),
                "copy" => "©".to_string(),
                _ => {
                    let n = if let Some(h) = e.strip_prefix("#x") { u32::from_str_radix(h, 16).ok() } else { e.strip_prefix('#').and_then(|d| d.parse().ok()) };
                    n.and_then(char::from_u32).map(|ch| ch.to_string()).unwrap_or_default()
                }
            }
        })
        .into_owned()
}

fn visible_text(html: &str) -> String {
    let no_scripts = SCRIPT_RE.replace_all(html, " ");
    let stripped = TAG_RE.replace_all(&no_scripts, " ");
    normalise_ws(&decode_entities(&stripped))
}

fn squash(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace()).collect()
}

fn between<'a>(s: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let start = s.find(open)? + open.len();
    let end = s[start..].find(close)? + start;
    Some(&s[start..end])
}

/// Text nodes of the captured `<main>` (≥ 12 chars) — sentences, labels, links.
fn main_text_nodes(html: &str) -> Vec<String> {
    let main = between(html, "<main>", "</main>").expect("fixture has <main>");
    let no_scripts = SCRIPT_RE.replace_all(main, " ");
    no_scripts.split('<').filter_map(|chunk| chunk.split_once('>').map(|(_, text)| text)).map(|t| normalise_ws(&decode_entities(t))).filter(|t| t.chars().count() >= 12).collect()
}

fn headings(html: &str) -> Vec<String> {
    let main = between(html, "<main>", "</main>").unwrap_or(html);
    HEADING_RE.captures_iter(main).map(|c| normalise_ws(&decode_entities(&TAG_RE.replace_all(&c[1], "")))).filter(|h| !h.is_empty()).collect()
}

const PAGES: [(&str, &str); 19] = [
    ("/", "index"),
    ("/adversarial-debate", "adversarial-debate"),
    ("/analysis-engine", "analysis-engine"),
    ("/about", "about"),
    ("/blog", "blog"),
    ("/case-law-db", "case-law-db"),
    ("/contact", "contact"),
    ("/documentation", "documentation"),
    ("/era-2025", "era-2025"),
    ("/ethics", "ethics"),
    ("/how-it-works", "how-it-works"),
    ("/methodology", "methodology"),
    ("/pricing", "pricing"),
    ("/privacy", "privacy"),
    ("/product", "product"),
    ("/request-access", "request-access"),
    ("/schema-builder", "schema-builder"),
    ("/security", "security"),
    ("/terms", "terms"),
];

const LIGHT_PAGES: [&str; 6] = ["/about", "/blog", "/contact", "/documentation", "/how-it-works", "/pricing"];

fn app() -> axum::Router {
    build_app(hermetic_config(true, "pages"), MockHttp::transport_error(), clock_at("2026-09-23"))
}

#[tokio::test]
async fn every_page_carries_the_captured_content() {
    let app = app();
    for (route, name) in PAGES {
        let fixture = load_text(&format!("pages/{name}.html"));
        let res = call(&app, get(route)).await;
        assert_eq!(res.status, 200, "{route}");
        assert!(res.header("content-type").unwrap_or("").starts_with("text/html"), "{route} content-type");
        let html = res.text();
        let text = visible_text(&html);
        let text_squashed = squash(&text);

        // <title> and meta description
        let want_title = decode_entities(between(&fixture, "<title>", "</title>").unwrap());
        let got_title = decode_entities(between(&html, "<title>", "</title>").unwrap());
        assert_eq!(got_title, want_title, "{route} title");
        let want_desc = decode_entities(between(&fixture, "name=\"description\" content=\"", "\"").unwrap());
        let got_desc = decode_entities(between(&html, "name=\"description\" content=\"", "\"").unwrap());
        assert_eq!(got_desc, want_desc, "{route} description");

        // Every heading of the captured page
        for h in headings(&fixture) {
            assert!(text.contains(&h) || text_squashed.contains(&squash(&h)), "{route}: heading {h:?} missing");
        }
        // Every text node of the captured <main>
        for node in main_text_nodes(&fixture) {
            assert!(text.contains(&node) || text_squashed.contains(&squash(&node)), "{route}: text {node:?} missing");
        }
        // Theme wrapper parity and the persistent LSA 2007 disclaimer
        assert_eq!(html.contains("theme-light"), LIGHT_PAGES.contains(&route), "{route}: light theme");
        assert_eq!(fixture.contains("theme-light"), LIGHT_PAGES.contains(&route), "{route}: fixture light theme");
        assert!(text.contains("Tribunal Harness provides legal information, not legal advice."), "{route}: footer disclaimer");
        assert!(html.contains("<main>"), "{route}: <main>");
        assert!(html.contains("href=\"/static/app.css\""), "{route}: stylesheet");
    }
}

#[tokio::test]
async fn consent_gates_and_nav_are_present() {
    let app = app();
    for route in ["/", "/adversarial-debate"] {
        let html = call(&app, get(route)).await.text();
        let text = visible_text(&html);
        assert!(
            squash(&text).contains(&squash(
                "I understand this tool provides legal information, not legal advice. I consent to my case description being processed by Tribunal Harness and Anthropic"
            )),
            "{route}: consent wording"
        );
        assert!(html.contains("type=\"checkbox\""), "{route}: consent checkbox");
        // The run button starts disabled until consent is given.
        assert!(html.contains("disabled"), "{route}: run button disabled");
    }
    let html = call(&app, get("/about")).await.text();
    for (href, label) in [
        ("/how-it-works", "How It Works"),
        ("/analysis-engine", "Analysis"),
        ("/documentation", "Docs"),
        ("/pricing", "Pricing"),
        ("/about", "About"),
        ("/security", "Security"),
        ("/ethics", "Ethics"),
        ("/methodology", "Methodology"),
        ("/blog", "Blog"),
        ("/request-access", "Request Access"),
    ] {
        assert!(html.contains(&format!("href=\"{href}\"")), "nav link {href}");
        assert!(html.contains(label), "nav label {label}");
    }
    assert!(html.contains("id=\"mobile-menu\""));
    assert!(html.contains("id=\"trust-dropdown\""));
    assert!(html.contains("text-purple-400\">About"), "active nav link styling");
    assert!(html.contains("© 2026 Tribunal Harness."));
    // Static assets are served from the binary.
    let css = call(&app, get("/static/app.css")).await;
    assert_eq!(css.status, 200);
    let css_text = css.text();
    assert!(css_text.contains(".theme-light"));
    // Noir design tokens (F12): pure black, purple accent, cream footer.
    for token in ["--color-bg-primary:#000", "--color-accent-purple:#8b5cf6", "--color-bg-cream:#e8e3d5", ".glass-thick", ".nav-pill", ".site-footer"] {
        assert!(css_text.to_lowercase().contains(token), "stylesheet lacks {token}");
    }
    let font = call(&app, get("/static/fonts/outfit-normal-300_600.woff2")).await;
    assert_eq!(font.status, 200);
    assert_eq!(&font.body[..4], b"wOF2");
}

#[tokio::test]
async fn analysis_results_fragment() {
    let app = app();
    let cases = load("ui/analysis-results-view.json");
    for (i, c) in cases["cases"].as_array().unwrap().iter().enumerate() {
        let res = call(&app, post_json("/_ui/fragments/analysis-results", &json!({ "results": c["input"], "timeline": [] }), &[])).await;
        assert_eq!(res.status, 200, "case {i}");
        let text = visible_text(&res.text());
        assert!(text.contains("Analysis Results"), "case {i}");
        let view = &c["result"];
        for claim in view["claims"].as_array().unwrap() {
            assert!(text.contains(claim["type"].as_str().unwrap()), "case {i}: claim");
            assert!(text.contains(claim["strength"].as_str().unwrap()), "case {i}: strength");
        }
        for auth in view["displayedAuthorities"].as_array().unwrap() {
            assert!(text.contains(auth["name"].as_str().unwrap()) || text.contains(auth["matched_case"].as_str().unwrap_or("")), "case {i}: authority");
        }
        let stripped = view["strippedQuarantineCount"].as_u64().unwrap();
        if stripped > 0 {
            assert!(text.contains(&format!("{stripped} ungrounded claim{} removed.", if stripped == 1 { "" } else { "s" })), "case {i}: quarantine count");
        } else {
            assert!(!text.contains("ungrounded claim"), "case {i}");
        }
        assert!(!text.contains("Invented v Nobody"), "case {i}: quarantined authority text must never render");
        for flag in view["eraFlags"].as_array().unwrap() {
            assert!(text.contains(flag["provision"].as_str().unwrap()), "case {i}: flag");
            if flag["status"] == json!("tbc") {
                assert!(text.contains("Exact commencement date to be confirmed by Statutory Instrument."));
            }
        }
    }
    // Error card
    let res = call(&app, post_json("/_ui/fragments/analysis-results", &json!({ "results": { "error": "boom happened" }, "timeline": [] }), &[])).await;
    let text = visible_text(&res.text());
    assert!(text.contains("Analysis couldn't finish") && text.contains("boom happened"));
    // Timeline from a recorded /api/roadmap response
    let routes = load("routes/responses.json");
    let timeline = routes["routes"]["roadmap_post"][1]["response"]["body"].clone();
    let res = call(&app, post_json("/_ui/fragments/analysis-results", &json!({ "results": {}, "timeline": timeline }), &[])).await;
    let html = res.text();
    let text = visible_text(&html);
    assert!(text.contains("Procedural Roadmap"));
    assert!(text.contains("Employment Tribunal") && text.contains("3 Steps"));
    assert!(text.contains("ACAS Early Conciliation") && text.contains("ET1 Claim Form") && text.contains("Case Management Preliminary Hearing"));
    assert!(text.contains("15 Sept 2025"), "en-GB short date: {text}");
    assert!(text.contains("Critical Deadline"));
    assert!(html.contains("data-timeline-toggle"));
    // A non-array timeline (an /api/roadmap 400 body) renders no roadmap, as in React.
    let res = call(&app, post_json("/_ui/fragments/analysis-results", &json!({ "results": {}, "timeline": { "error": "dateOfLastAct is required" } }), &[])).await;
    assert!(!visible_text(&res.text()).contains("Procedural Roadmap"));
    let bad = call(&app, post_raw("/_ui/fragments/analysis-results", "{nope", "application/json", &[])).await;
    assert_eq!(bad.status, 400);
}

#[tokio::test]
async fn debate_results_fragment() {
    let app = app();
    let routes = load("routes/responses.json");
    let mut seen_adversarial = false;
    for c in routes["routes"]["debate"].as_array().unwrap() {
        if c["response"]["status"] != json!(200) {
            continue;
        }
        let body: &Value = &c["response"]["body"];
        let res = call(&app, post_json("/_ui/fragments/debate-results", body, &[])).await;
        assert_eq!(res.status, 200);
        let text = visible_text(&res.text());
        assert!(text.contains("Debate Result"));
        assert!(text.contains("input · ") && text.contains("output tokens"));
        if body["mode"] == json!("adversarial") {
            seen_adversarial = true;
            assert!(text.contains("ADVERSARIAL") && text.contains("Rounds") && text.contains("Round 1") && text.contains("Final, revised argument"));
            assert!(text.contains("Adversarial mode ran"));
        } else {
            assert!(text.contains("SINGLE PASS") && text.contains("Single pass — one Drafter → Critic → Judge round."));
            assert!(text.contains("Judge — assessment") && text.contains("SCORE"));
        }
        assert!(text.contains("Drafter — strongest case") || text.contains("Critic — opposing counsel's attacks"));
    }
    assert!(seen_adversarial);
    let bad = call(&app, post_raw("/_ui/fragments/debate-results", "nope", "application/json", &[])).await;
    assert_eq!(bad.status, 400);
}

#[tokio::test]
async fn schema_and_case_law_fragments() {
    let app = app();
    let schemas = load("schemas/all-schemas.json");
    let ud = schemas["SCHEMAS"]["unfair_dismissal"].clone();
    assert!(ud.is_object(), "unfair_dismissal schema fixture");
    let res = call(&app, get("/_ui/fragments/schema/unfair_dismissal")).await;
    assert_eq!(res.status, 200);
    let text = visible_text(&res.text());
    assert!(text.contains(ud["label"].as_str().unwrap()) && text.contains(ud["statute"].as_str().unwrap()));
    for t in ud["legalTest"].as_array().unwrap() {
        assert!(text.contains(t.as_str().unwrap()), "legal test {t}");
    }
    for a in ud["keyAuthorities"].as_array().unwrap() {
        assert!(text.contains(a.as_str().unwrap()), "authority {a}");
    }
    assert!(text.contains(&format!("Schema Fields ({})", ud["fields"].as_array().unwrap().len())));
    assert!(text.contains("ERA 2025 Changes"));
    let res = call(&app, get("/_ui/fragments/schema/made_up")).await;
    assert!(visible_text(&res.text()).contains("Select a claim type to explore its schema."));

    let res = call(&app, get("/_ui/fragments/case-law-results?q=Polkey&limit=10")).await;
    let text = visible_text(&res.text());
    // The seed scorer awards tier points even without a text match, so the
    // recorded TypeScript response for q=Polkey has 10 results (Polkey first).
    assert!(
        text.contains("10 results — seed data v1") && text.contains("Polkey v AE Dayton Services Ltd") && text.contains("BINDING") && text.contains("unfair dismissal"),
        "{text}"
    );
    assert!(text.find("Polkey v AE Dayton Services Ltd").unwrap() < text.find("Various Claimants v Wm Morrison Supermarkets plc").unwrap());
    // (A text-only miss still returns tier-scored cases; an unmatched claim type is empty.)
    let res = call(&app, get("/_ui/fragments/case-law-results?claim_type=nonexistent_type&limit=10")).await;
    assert!(visible_text(&res.text()).contains("No cases found for your search. Try different terms or remove the claim type filter."));
    let res = call(&app, get("/_ui/fragments/case-law-results?tier=statutory")).await;
    assert!(visible_text(&res.text()).contains("Provide at least one of: q (search query) or claim_type"));
    let res = call(&app, get("/_ui/fragments/case-law-results?claim_type=unfair_dismissal&limit=10")).await;
    assert!(visible_text(&res.text()).contains("results — seed data v1"));
}
