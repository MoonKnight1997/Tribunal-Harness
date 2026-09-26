//! UI primitives (`components/ui/*`), the analysis / debate result panels,
//! the Timeline, the ERA 2025 tracker table and the schema display.

use crate::jsval::{template, truthy};
use crate::ui::icons::{self, icon};
use maud::{html, Markup};
use serde_json::{json, Value};
use th_core::constants::{TrackerStatus, CLAIM_TYPES, ERA_2025_TRACKER};
use th_core::dates::CivilDate;
use th_core::seed_cases::SearchOutcome;
use th_core::types::{ClaimSchema, ClaimStrength, EraFlagStatus, TrustLevel};
use th_core::ui_view::analysis_results::{build_analysis_results_view, flag_status_label};
use th_core::ui_view::debate_modes::{
    describe_rounds, format_usage, get_argument_text, get_score, get_synthesis_text, partition_authorities, viability_label, DebateMode, DisplayAuthority,
};

// ─── Badge ───────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum BadgeVariant {
    Verified,
    Warning,
    Unverified,
    Quarantined,
    Neutral,
}

pub fn badge(variant: BadgeVariant, class: &str, content: Markup) -> Markup {
    let classes = match variant {
        BadgeVariant::Verified => "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
        BadgeVariant::Warning => "bg-amber-500/10 text-amber-400 border-amber-500/30",
        BadgeVariant::Unverified | BadgeVariant::Quarantined => "bg-red-500/10 text-red-400 border-red-500/30",
        BadgeVariant::Neutral => "bg-[rgba(255,255,255,0.05)] text-[var(--color-text-secondary)] border-[var(--color-border-subtle)]",
    };
    let ic = match variant {
        BadgeVariant::Verified => Some(&icons::SHIELD_CHECK),
        BadgeVariant::Warning => Some(&icons::CIRCLE_ALERT),
        BadgeVariant::Unverified | BadgeVariant::Quarantined => Some(&icons::CIRCLE_X),
        BadgeVariant::Neutral => None,
    };
    html! {
        span class=(format!("inline-flex items-center px-2 py-0.5 rounded text-[10px] font-[var(--font-mono)] uppercase tracking-wider font-bold border {classes} {class}")) {
            @if let Some(i) = ic { (icon(i, 24, "w-3 h-3 mr-1", "", None)) }
            (content)
        }
    }
}

// ─── Card ────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CardVariant {
    Solid,
    Wireframe,
    Glass,
}

pub fn card(variant: CardVariant, class: &str, style: Option<&str>, content: Markup) -> Markup {
    let classes = match variant {
        CardVariant::Solid => "bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)]",
        CardVariant::Wireframe => "bg-transparent border border-[rgba(255,255,255,0.06)]",
        CardVariant::Glass => "bg-[rgba(255,255,255,0.03)] backdrop-blur-md ring-1 ring-white/10",
    };
    html! {
        div class=(format!("rounded-[var(--radius-card)] p-6 shadow-sm transition-all {classes} {class}")) style=[style] { (content) }
    }
}

// ─── Button ──────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ButtonVariant {
    Primary,
    Outline,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ButtonSize {
    Sm,
    Md,
}

pub fn button_classes(variant: ButtonVariant, size: ButtonSize) -> String {
    let base = "inline-flex items-center justify-center font-sans font-semibold tracking-wide transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--color-bg-primary)] disabled:opacity-50 disabled:pointer-events-none rounded-md uppercase";
    let v = match variant {
        ButtonVariant::Primary => "bg-[var(--color-accent-purple)] text-white hover:brightness-110 active:scale-[0.98] shadow-[0_0_20px_rgba(139,92,246,0.2)]",
        ButtonVariant::Outline => "bg-transparent border border-[var(--color-accent-purple)] text-[var(--color-accent-purple)] hover:bg-[rgba(139,92,246,0.1)]",
    };
    let s = match size {
        ButtonSize::Sm => "h-8 px-3 text-xs",
        ButtonSize::Md => "h-10 px-6 text-sm",
    };
    format!("{base} {v} {s}")
}

// ─── Claim type <option>s (CLAIM_TYPES, ★ for ERA 2025 types) ────────────

pub fn claim_type_options(selected: &str) -> Markup {
    html! {
        @for ct in CLAIM_TYPES.iter() {
            option value=(ct.id) style="color:black" selected[ct.id == selected] { (ct.label) " " (if ct.era2025 { "★" } else { "" }) }
        }
    }
}

// ─── Timeline ────────────────────────────────────────────────────────────

const MONTHS_EN_GB_SHORT: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

/// `toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })`
/// of the deadline's UTC date; "TBC" when absent or unparseable.
pub fn format_timeline_date(v: &Value) -> String {
    let Some(s) = v.as_str() else { return "TBC".into() };
    match CivilDate::parse_utc(s.get(..10).unwrap_or(s)) {
        Some(d) => format!("{} {} {}", d.day, MONTHS_EN_GB_SHORT[(d.month as usize).saturating_sub(1).min(11)], d.year),
        None => "TBC".into(),
    }
}

fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

pub fn timeline(stages: &[Value]) -> Markup {
    let first_level = stages.first().map(|st| s(st, "level").to_string());
    html! {
        div class="space-y-4" data-timeline {
            @for stage in stages {
                @let level = s(stage, "level");
                @let color = s(stage, "color");
                @let expanded = first_level.as_deref() == Some(level);
                @let steps: Vec<&Value> = stage.get("steps").and_then(Value::as_array).map(|a| a.iter().collect()).unwrap_or_default();
                div class=(format!("rounded-[var(--radius-card)] p-6 shadow-sm transition-all bg-transparent border border-[rgba(255,255,255,0.06)] transition-all duration-300 overflow-hidden {}", if expanded { "border-opacity-100 bg-[rgba(255,255,255,0.02)] expanded" } else { "border-opacity-40 hover:border-opacity-60" }))
                    style=[expanded.then(|| format!("border-color:{color}"))] data-timeline-stage=(level) data-color=(color) {
                    div class="flex items-center justify-between cursor-pointer" data-timeline-toggle=(level) {
                        div class="flex items-center gap-4" {
                            div class="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm bg-[var(--color-bg-secondary)] border border-[rgba(255,255,255,0.1)]" style=(format!("color:{color};border-color:{color}")) { (s(stage, "abbrev")) }
                            div {
                                h3 class="text-lg font-[var(--font-serif)] font-medium text-white" { (level) }
                                p class="text-xs text-[var(--color-text-secondary)] uppercase tracking-wider font-[var(--font-mono)]" { (steps.len()) " Steps" }
                            }
                        }
                        div class="text-[var(--color-text-secondary)]" {
                            span data-chev="down" hidden[!expanded] { (icon(&icons::CHEVRON_DOWN, 20, "", "", None)) }
                            span data-chev="right" hidden[expanded] { (icon(&icons::CHEVRON_RIGHT, 20, "", "", None)) }
                        }
                    }
                    div class="mt-6 space-y-6 pl-5 border-l border-[rgba(255,255,255,0.1)] ml-5" data-timeline-steps hidden[!expanded] {
                        @for step in steps {
                            @let status = s(step, "status");
                            @let critical = step.get("critical").and_then(Value::as_bool).unwrap_or(false);
                            @let deadline = step.get("deadline");
                            div class="relative pl-6" {
                                div class=(format!("absolute -left-[25px] top-1 w-3 h-3 rounded-full border-2 bg-[var(--color-bg-primary)] z-10 {}", match status {
                                    "overdue" => "border-red-500 bg-red-500/20",
                                    "upcoming" => "border-[var(--color-accent-purple)] bg-[var(--color-accent-purple-glow)]",
                                    _ => "border-[rgba(255,255,255,0.2)] bg-[var(--color-bg-secondary)]",
                                })) {}
                                div class="flex flex-col sm:flex-row sm:items-start justify-between gap-2 mb-1" {
                                    h4 class=(format!("text-sm font-bold font-[var(--font-mono)] uppercase tracking-wide {}", if critical { "text-white" } else { "text-[var(--color-text-secondary)]" })) { (s(step, "label")) }
                                    @if truthy(deadline) {
                                        (badge(match status { "overdue" => BadgeVariant::Unverified, "upcoming" => BadgeVariant::Warning, _ => BadgeVariant::Neutral }, "self-start", html! {
                                            (icon(&icons::CALENDAR_DAYS, 10, "mr-1.5", "", None))
                                            (format_timeline_date(deadline.unwrap()))
                                        }))
                                    }
                                }
                                p class="text-sm text-[var(--color-text-secondary)] leading-relaxed mb-2" { (s(step, "description")) }
                                @if critical {
                                    div class="flex items-center gap-1.5 text-[10px] text-[var(--color-error-coral)] font-[var(--font-mono)] uppercase tracking-widest mt-2" {
                                        (icon(&icons::CIRCLE_ALERT, 10, "", "", None))
                                        "Critical Deadline"
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// ─── Analysis results panel ──────────────────────────────────────────────

fn strength_badge(strength: ClaimStrength) -> BadgeVariant {
    match strength {
        ClaimStrength::Strong => BadgeVariant::Verified,
        ClaimStrength::Moderate => BadgeVariant::Warning,
        ClaimStrength::Weak => BadgeVariant::Unverified,
    }
}

pub fn analysis_results_panel(results: &Value, timeline_stages: &Value) -> Markup {
    if let Some(err) = results.get("error").filter(|e| truthy(Some(e))) {
        return html! {
            div style="position:relative;height:100%;display:flex;align-items:center;justify-content:center" {
                (card(CardVariant::Wireframe, "", Some("border-color:rgba(239, 68, 68, 0.3)"), html! {
                    h3 style="color:var(--color-error-coral);margin-bottom:0.5rem" { "Analysis couldn't finish" }
                    p style="color:var(--color-text-secondary);font-size:0.9rem;line-height:1.6" { (template(err)) }
                }))
            }
        };
    }
    let view = build_analysis_results_view(results);
    let stages: Vec<Value> = timeline_stages.as_array().cloned().unwrap_or_default();
    html! {
        div class="stage-enter" style="width:100%;overflow-y:auto;max-height:80vh;padding-right:1rem" {
            div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:2rem" {
                div style="padding:0.5rem;background:rgba(255,255,255,0.05);border-radius:8px;border:1px solid rgba(255,255,255,0.1)" {
                    (icon(&icons::SCALE, 24, "", "color:var(--color-accent-purple);width:20px;height:20px", None))
                }
                h2 style="font-family:var(--font-serif);font-size:1.75rem;margin:0" { "Analysis Results" }
            }

            @if !view.claims.is_empty() {
                div style="margin-bottom:2.5rem" {
                    div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1rem" {
                        (icon(&icons::FILE_TEXT, 16, "", "", Some("var(--color-text-secondary)")))
                        h3 class="text-subhead" style="margin:0" { "Identified Claims" }
                    }
                    div style="display:flex;flex-direction:column;gap:1rem" {
                        @for claim in &view.claims {
                            (card(CardVariant::Solid, "hover:border-[var(--color-accent-purple)]/50", Some("transition:all 0.2s"), html! {
                                div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:1rem" {
                                    h4 style="font-size:1.1rem;font-weight:600;margin:0" { (claim.claim_type) }
                                    (badge(strength_badge(claim.strength), "", html! { (claim.strength.as_str()) }))
                                }
                                p style="font-size:0.9rem;color:var(--color-text-secondary);margin-bottom:1rem;line-height:1.6" { (claim.reasoning) }
                                div style="background:rgba(0,0,0,0.2);padding:0.75rem;border-radius:6px" {
                                    p style="font-size:0.65rem;font-family:var(--font-mono);text-transform:uppercase;color:var(--color-text-muted);margin-bottom:0.5rem" { "Elements to Prove" }
                                    ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:0.5rem" {
                                        @for el in &claim.legal_test_elements {
                                            li style="display:flex;gap:0.5rem;font-size:0.85rem" {
                                                span style=(format!("color:{};flex-shrink:0", if el.satisfied { "#2dd4bf" } else { "#ef4444" })) { (if el.satisfied { "✓" } else { "✗" }) }
                                                span style="color:var(--color-text-secondary)" { (el.element) }
                                            }
                                        }
                                    }
                                }
                            }))
                        }
                    }
                }
            }

            @if !view.displayed_authorities.is_empty() || view.stripped_quarantine_count > 0 {
                div style="margin-bottom:2.5rem" {
                    div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1rem" {
                        (icon(&icons::SCALE, 16, "", "", Some("var(--color-text-secondary)")))
                        h3 class="text-subhead" style="margin:0" { "Legal Authorities & Epistemic Quarantine" }
                    }
                    div style="display:flex;flex-direction:column;gap:0.75rem" {
                        @for auth in &view.displayed_authorities {
                            @let verified = auth.trust_level == Some(TrustLevel::Verified);
                            (card(CardVariant::Wireframe, "", Some(&format!("border-left-width:3px;border-left-color:{};padding:1rem", if verified { "#10b981" } else { "#f59e0b" })), html! {
                                div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:0.5rem" {
                                    div {
                                        h4 style="font-size:1rem;font-weight:600;margin:0" { (auth.matched_case.as_deref().filter(|m| !m.is_empty()).unwrap_or(&auth.name)) }
                                        p style="font-size:0.75rem;font-family:var(--font-mono);color:var(--color-text-muted);margin-top:0.25rem;margin:0" { (auth.citation) }
                                    }
                                    (badge(if verified { BadgeVariant::Verified } else { BadgeVariant::Warning }, "", html! { (auth.trust_level.map(|t| t.as_str()).unwrap_or("CHECK")) }))
                                }
                                p style="font-size:0.85rem;color:var(--color-text-secondary);margin:0" { (auth.validation_reason.as_deref().filter(|r| !r.is_empty()).unwrap_or(&auth.principle)) }
                            }))
                        }
                        @if view.stripped_quarantine_count > 0 {
                            div style="display:flex;align-items:flex-start;gap:0.6rem;padding:0.85rem 1rem;border-radius:6px;border:1px solid rgba(239, 68, 68, 0.3);background:rgba(239, 68, 68, 0.06)" {
                                (icon(&icons::SHIELD_OFF, 16, "", "flex-shrink:0;margin-top:2px", Some("#ef4444")))
                                p style="font-size:0.8rem;color:var(--color-text-secondary);margin:0;line-height:1.5" {
                                    strong style="color:#ef4444" { (view.stripped_quarantine_count) " ungrounded claim" (if view.stripped_quarantine_count == 1 { "" } else { "s" }) " removed." }
                                    " Citations that could not be verified against a known authority were quarantined and withheld from this analysis."
                                }
                            }
                        }
                    }
                }
            }

            @if !view.era_flags.is_empty() {
                div style="margin-bottom:2.5rem" {
                    h3 class="text-subhead" style="margin-bottom:1rem" { "ERA 2025 Compliance" }
                    div style="display:flex;flex-direction:column;gap:1rem" {
                        @for flag in &view.era_flags {
                            div style="padding:1rem;border-left:2px solid var(--color-accent-purple);background:rgba(139,92,246,0.05);border-radius:0 8px 8px 0" {
                                div style="display:flex;justify-content:space-between;margin-bottom:0.5rem" {
                                    span style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;color:var(--color-accent-purple)" { (flag_status_label(flag.status)) }
                                    span style="font-family:var(--font-mono);font-size:0.7rem;opacity:0.7" { (flag.commencement_date) }
                                }
                                p style="font-size:0.9rem;font-weight:600;margin:0 0 0.25rem 0" { (flag.provision) }
                                p style="font-size:0.85rem;color:var(--color-text-secondary);margin:0" { (flag.reason) }
                                @if flag.status == EraFlagStatus::Tbc {
                                    p style="font-size:0.75rem;font-style:italic;color:var(--color-text-muted);margin:0.5rem 0 0 0" { "Exact commencement date to be confirmed by Statutory Instrument." }
                                }
                            }
                        }
                    }
                }
            }

            @if !stages.is_empty() {
                div style="margin-bottom:2.5rem" {
                    div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1rem" {
                        (icon(&icons::CALENDAR, 16, "", "", Some("var(--color-text-secondary)")))
                        h3 class="text-subhead" style="margin:0" { "Procedural Roadmap" }
                    }
                    (timeline(&stages))
                }
            }
        }
    }
}

// ─── Debate results ──────────────────────────────────────────────────────

fn fmt_score(score: f64) -> String {
    if score.fract() == 0.0 {
        format!("{}", score as i64)
    } else {
        format!("{score}")
    }
}

fn viability_badge(viable: Option<bool>) -> BadgeVariant {
    match viable {
        Some(true) => BadgeVariant::Verified,
        Some(false) => BadgeVariant::Unverified,
        None => BadgeVariant::Neutral,
    }
}

fn agent_section(ic: &icons::Icon, title: &str, body: Markup) -> Markup {
    html! {
        div style="margin-bottom:1.25rem" {
            div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.6rem;color:var(--color-accent-purple)" {
                (icon(ic, 15, "", "", None))
                span style="font-size:0.7rem;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:0.1em" { (title) }
            }
            (body)
        }
    }
}

fn authority_list(authorities: &[DisplayAuthority]) -> Markup {
    html! {
        div style="display:flex;flex-direction:column;gap:0.6rem;margin-bottom:0.5rem" {
            @for auth in authorities {
                @let verified = auth.trust_level == Some(TrustLevel::Verified);
                div style=(format!("border-left:3px solid {};padding:0.6rem 0.85rem;background:rgba(0,0,0,0.2);border-radius:0 6px 6px 0", if verified { "#10b981" } else { "#f59e0b" })) {
                    div style=(format!("display:flex;justify-content:space-between;align-items:start;gap:0.75rem;margin-bottom:{}", if auth.detail.is_empty() { "0" } else { "0.35rem" })) {
                        div {
                            p style="font-size:0.9rem;font-weight:600;margin:0" { (auth.title) }
                            @if !auth.citation.is_empty() {
                                p style="font-size:0.72rem;font-family:var(--font-mono);color:var(--color-text-muted);margin:0.2rem 0 0 0" { (auth.citation) }
                            }
                        }
                        (badge(if verified { BadgeVariant::Verified } else { BadgeVariant::Warning }, "", html! { (auth.trust_level.map(|t| t.as_str()).unwrap_or("CHECK")) }))
                    }
                    @if !auth.detail.is_empty() {
                        p style="font-size:0.82rem;color:var(--color-text-secondary);margin:0;line-height:1.5" { (auth.detail) }
                    }
                }
            }
        }
    }
}

const PROSE_STYLE: &str = "font-size:0.9rem;color:var(--color-text-secondary);margin:0;line-height:1.65;white-space:pre-wrap";

fn round_view(round: &Value, heading: Option<String>, highlight: bool) -> Markup {
    let drafter = round.get("drafter");
    let critic = round.get("critic");
    let judge = round.get("judge");
    let argument = get_argument_text(drafter);
    let synthesis = get_synthesis_text(judge);
    let score = get_score(Some(round), judge);
    let viable = round.get("viable").and_then(Value::as_bool).or_else(|| score.map(|sc| sc >= 70.0));
    let drafter_auth = partition_authorities(drafter.and_then(|d| d.get("legal_framework")), Some("authority"));
    let critic_auth = partition_authorities(critic.and_then(|c| c.get("attacks")), None);
    let quarantined = drafter_auth.quarantined + critic_auth.quarantined;
    let variant = if highlight { CardVariant::Solid } else { CardVariant::Wireframe };
    card(
        variant,
        "",
        if highlight { Some("border-color:rgba(139,92,246,0.35)") } else { None },
        html! {
            @if let Some(h) = &heading {
                div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem" {
                    h4 style="font-size:1rem;font-weight:600;margin:0" { (h) }
                    @if let Some(sc) = score {
                        (badge(viability_badge(viable), "", html! { "SCORE " (fmt_score(sc)) " / 100" }))
                    }
                }
            }
            @if !argument.is_empty() {
                (agent_section(&icons::SCALE, "Drafter — strongest case", html! { p style=(PROSE_STYLE) { (argument) } }))
            }
            @if !drafter_auth.displayed.is_empty() { (authority_list(&drafter_auth.displayed)) }
            @if !critic_auth.displayed.is_empty() {
                (agent_section(&icons::SWORD, "Critic — opposing counsel's attacks", authority_list(&critic_auth.displayed)))
            }
            @if !synthesis.is_empty() {
                (agent_section(&icons::GAVEL, "Judge — assessment", html! {
                    p style=(PROSE_STYLE) { (synthesis) }
                    @if let (Some(sc), None) = (score, &heading) {
                        div style="margin-top:0.6rem" {
                            (badge(viability_badge(viable), "", html! { "SCORE " (fmt_score(sc)) " / 100 · " (viability_label(viable)) }))
                        }
                    }
                }))
            }
            @if quarantined > 0 {
                div style="display:flex;align-items:flex-start;gap:0.6rem;margin-top:1rem;padding:0.75rem 1rem;border-radius:6px;border:1px solid rgba(239, 68, 68, 0.3);background:rgba(239, 68, 68, 0.06)" {
                    (icon(&icons::SHIELD_OFF, 16, "", "flex-shrink:0;margin-top:2px", Some("#ef4444")))
                    p style="font-size:0.78rem;color:var(--color-text-secondary);margin:0;line-height:1.5" {
                        strong style="color:#ef4444" { (quarantined) " ungrounded citation" (if quarantined == 1 { "" } else { "s" }) " withheld." }
                        " Citations that could not be verified against a known authority were quarantined and stripped from this round."
                    }
                }
            }
        },
    )
}

pub fn debate_results(result: &Value) -> Markup {
    let mode = if result.get("mode").and_then(Value::as_str) == Some("adversarial") { DebateMode::Adversarial } else { DebateMode::SinglePass };
    let rounds: Vec<Value> = if mode == DebateMode::Adversarial { result.get("iterations").and_then(Value::as_array).cloned().unwrap_or_default() } else { vec![] };
    let final_round: Option<Value> = if mode == DebateMode::Adversarial {
        result.get("final").filter(|f| !f.is_null()).cloned()
    } else {
        Some(json!({
            "drafter": result.get("drafter").cloned().unwrap_or(Value::Null),
            "critic": result.get("critic").cloned().unwrap_or(Value::Null),
            "judge": result.get("judge").cloned().unwrap_or(Value::Null),
            "score": get_score(None, result.get("judge")),
            "viable": result.get("viable").cloned().unwrap_or(Value::Null),
        }))
    };
    let final_viable: Option<bool> =
        if mode == DebateMode::Adversarial { result.get("final").and_then(|f| f.get("viable")).and_then(Value::as_bool) } else { result.get("viable").and_then(Value::as_bool) };
    let rounds_run = result.get("rounds_run").and_then(Value::as_i64);
    let stopped_early = result.get("stopped_early").and_then(Value::as_bool).unwrap_or(false);
    html! {
        div {
            div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1.25rem" {
                div style="padding:0.5rem;background:rgba(255,255,255,0.05);border-radius:8px;border:1px solid rgba(255,255,255,0.1)" {
                    (icon(&icons::GAVEL, 24, "", "color:var(--color-accent-purple);width:20px;height:20px", None))
                }
                h2 style="font-family:var(--font-serif);font-size:1.75rem;margin:0" { "Debate Result" }
            }
            (card(CardVariant::Solid, "", Some("margin-bottom:2rem"), html! {
                div style="display:flex;flex-wrap:wrap;gap:1rem;align-items:center;justify-content:space-between" {
                    div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap" {
                        (badge(if mode == DebateMode::Adversarial { BadgeVariant::Warning } else { BadgeVariant::Neutral }, "", html! { (if mode == DebateMode::Adversarial { "ADVERSARIAL" } else { "SINGLE PASS" }) }))
                        (badge(viability_badge(final_viable), "", html! { (viability_label(final_viable)) }))
                    }
                    span style="font-family:var(--font-mono);font-size:0.75rem;color:var(--color-text-muted)" { (format_usage(result.get("usage"))) }
                }
                p style="font-size:0.82rem;color:var(--color-text-secondary);margin:0.85rem 0 0 0;line-height:1.5" { (describe_rounds(mode, rounds_run, stopped_early)) }
            }))
            @if mode == DebateMode::Adversarial && !rounds.is_empty() {
                div style="margin-bottom:2rem" {
                    h3 class="text-subhead" style="margin-bottom:1rem" { "Rounds" }
                    div style="display:flex;flex-direction:column;gap:1.5rem" {
                        @for (i, r) in rounds.iter().enumerate() {
                            @let n = r.get("round").filter(|v| !v.is_null()).map(template).unwrap_or_else(|| (i + 1).to_string());
                            (round_view(r, Some(format!("Round {n}")), false))
                        }
                    }
                }
            }
            @if let Some(fr) = &final_round {
                div {
                    h3 class="text-subhead" style="margin-bottom:1rem" { (if mode == DebateMode::Adversarial { "Final, revised argument" } else { "Result" }) }
                    (round_view(fr, None, true))
                }
            }
        }
    }
}

// ─── ERA 2025 tracker table (era-2025 + documentation pages) ─────────────

pub fn era_tracker_table() -> Markup {
    const TH: &str = "text-align:left;padding:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;font-size:0.7rem;color:var(--color-text-secondary)";
    html! {
        div style="overflow-x:auto" {
            table style="width:100%;border-collapse:collapse;font-size:0.8rem" {
                thead {
                    tr style="border-bottom:1px solid var(--color-border-subtle)" {
                        @for h in ["Provision", "Old Position", "New Position", "Commencement", "Status"] { th style=(TH) { (h) } }
                    }
                }
                tbody {
                    @for row in ERA_2025_TRACKER.iter() {
                        @let (color, background, label) = match row.status {
                            TrackerStatus::InForce => ("#2dd4bf", "rgba(45,212,191,0.1)", "IN FORCE"),
                            TrackerStatus::Upcoming => ("var(--color-accent-purple)", "rgba(123,107,245,0.1)", "UPCOMING"),
                            TrackerStatus::AwaitingSi => ("#fbbf24", "rgba(251,191,36,0.1)", "AWAITING SI"),
                        };
                        tr style="border-bottom:1px solid var(--color-border-subtle)" {
                            td style="padding:0.75rem;font-weight:500" { (row.provision) }
                            td style="padding:0.75rem;color:var(--color-text-secondary)" { (row.old_position) }
                            td style="padding:0.75rem;color:var(--color-text-secondary)" { (row.new_position) }
                            td style="padding:0.75rem;font-family:var(--font-mono);font-size:0.75rem" { (row.commencement) }
                            td style="padding:0.75rem" {
                                span style=(format!("font-family:var(--font-mono);font-size:0.65rem;font-weight:600;padding:2px 6px;border-radius:4px;color:{color};background:{background}")) { (label) }
                            }
                        }
                    }
                }
            }
        }
    }
}

// ─── Schema display (analysis-engine page) ───────────────────────────────

pub fn schema_display(schema: &ClaimSchema) -> Markup {
    html! {
        div {
            h2 style="font-family:var(--font-serif);font-size:2rem;margin-bottom:0.5rem" { (schema.label) }
            p style="font-family:var(--font-mono);font-size:0.75rem;color:var(--color-accent-purple);margin-bottom:1rem" { (schema.statute) }
            p style="color:var(--color-text-secondary);margin-bottom:2rem;line-height:1.7" { (schema.description) }

            h3 style="font-family:var(--font-sans);font-weight:600;margin-bottom:0.75rem" { "Legal Test" }
            ol style="padding-left:1.5rem;color:var(--color-text-secondary);margin-bottom:2rem;line-height:2" {
                @for t in &schema.legal_test { li { (t) } }
            }

            @if let Some(changes) = &schema.era2025_changes {
                @if !changes.is_empty() {
                    h3 style="font-family:var(--font-sans);font-weight:600;margin-bottom:0.75rem;color:var(--color-accent-purple)" { "ERA 2025 Changes" }
                    ul style="list-style:none;margin-bottom:2rem" {
                        @for c in changes {
                            li style="padding:0.5rem 0;border-bottom:1px solid var(--color-border-subtle);color:var(--color-text-secondary);font-size:0.85rem" { "→ " (c) }
                        }
                    }
                }
            }

            h3 style="font-family:var(--font-sans);font-weight:600;margin-bottom:0.75rem" { "Key Authorities" }
            ul style="list-style:none;color:var(--color-text-secondary);font-size:0.85rem;line-height:2" {
                @for a in &schema.key_authorities { li style="font-family:var(--font-mono);font-size:0.75rem" { (a) } }
            }

            h3 style="font-family:var(--font-sans);font-weight:600;margin-top:2rem;margin-bottom:0.75rem" { "Schema Fields (" (schema.fields.len()) ")" }
            div style="display:grid;gap:0.5rem" {
                @for f in &schema.fields {
                    @let type_name = serde_json::to_value(f.field_type).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default();
                    div style="padding:0.75rem;border:1px solid var(--color-border-subtle);border-radius:6px;display:flex;justify-content:space-between;align-items:center" {
                        div {
                            span style="font-size:0.85rem;font-weight:500" { (f.label) }
                            span style="font-family:var(--font-mono);font-size:0.7rem;color:var(--color-text-secondary);margin-left:0.5rem" { (type_name) (if f.required { " • required" } else { "" }) }
                        }
                        @if let Some(a) = &f.era2025 {
                            span style="font-family:var(--font-mono);font-size:0.6rem;color:var(--color-accent-purple);font-weight:600" { (if a.is_new { "NEW" } else { "CHANGED" }) }
                        }
                    }
                }
            }
        }
    }
}

pub fn schema_empty_state() -> Markup {
    html! { p style="color:var(--color-text-secondary)" { "Select a claim type to explore its schema." } }
}

// ─── Case law search results (case-law-db page) ──────────────────────────

fn tier_color(tier: &str) -> &'static str {
    match tier {
        "binding" => "#2dd4bf",
        "persuasive" => "#8B5CF6",
        "statutory" => "#fbbf24",
        "guidance" => "#A0A0A0",
        _ => "#A0A0A0",
    }
}

fn tier_label(tier: &str) -> String {
    match tier {
        "binding" => "BINDING".into(),
        "persuasive" => "PERSUASIVE".into(),
        "statutory" => "STATUTORY".into(),
        "guidance" => "GUIDANCE".into(),
        other => other.to_uppercase(),
    }
}

pub fn case_law_error_box(message: &str) -> Markup {
    html! {
        div style="padding:1rem;border:1px solid var(--color-error-coral);border-radius:var(--radius-card);margin-bottom:1.5rem;color:var(--color-error-coral);font-size:0.85rem" { (message) }
    }
}

pub fn case_law_results(outcome: &SearchOutcome) -> Markup {
    match outcome {
        SearchOutcome::BadRequest(body) => case_law_error_box(body.get("error").and_then(Value::as_str).unwrap_or("Search failed.")),
        SearchOutcome::Ok(body) => {
            let results: Vec<&Value> = body.get("results").and_then(Value::as_array).map(|a| a.iter().collect()).unwrap_or_default();
            if results.is_empty() {
                return html! {
                    div class="interface-card" style="text-align:center;padding:3rem" {
                        p style="color:var(--color-text-secondary);font-family:var(--font-mono);font-size:0.85rem" { "No cases found for your search. Try different terms or remove the claim type filter." }
                    }
                };
            }
            html! {
                div style="display:flex;flex-direction:column;gap:1rem" {
                    p style="font-family:var(--font-mono);font-size:0.7rem;color:var(--color-text-secondary);margin-bottom:0.5rem" { (results.len()) " result" (if results.len() != 1 { "s" } else { "" }) " — seed data v1" }
                    @for c in results {
                        @let tier = s(c, "tier");
                        @let color = tier_color(tier);
                        @let verified = s(c, "trust_badge") == "VERIFIED";
                        div class="interface-card" style="display:grid;grid-template-columns:1fr auto;gap:1.5rem;align-items:start" {
                            div {
                                div style="display:flex;gap:0.75rem;align-items:center;margin-bottom:0.5rem;flex-wrap:wrap" {
                                    span style=(format!("font-family:var(--font-mono);font-size:0.75rem;font-weight:700;color:{color};padding:2px 6px;border:1px solid {color};border-radius:4px")) { (tier_label(tier)) }
                                    span style=(format!("font-family:var(--font-mono);font-size:0.65rem;padding:2px 6px;border-radius:4px;background:{};color:{}", if verified { "rgba(45,212,191,0.1)" } else { "rgba(251,191,36,0.1)" }, if verified { "#2dd4bf" } else { "#fbbf24" })) { (s(c, "trust_badge")) }
                                    span style="font-family:var(--font-mono);font-size:0.7rem;color:var(--color-text-secondary)" { (s(c, "citation")) }
                                }
                                h3 style="font-family:var(--font-serif);font-size:1.2rem;margin-bottom:0.5rem" { (s(c, "case_name")) }
                                p style="font-size:0.8rem;color:var(--color-text-secondary);line-height:1.6;margin-bottom:0.75rem" { (s(c, "summary")) }
                                div style="display:flex;gap:0.5rem;flex-wrap:wrap" {
                                    @for ct in c.get("claim_types").and_then(Value::as_array).into_iter().flatten() {
                                        span style="font-family:var(--font-mono);font-size:0.65rem;padding:2px 6px;background:rgba(139,92,246,0.08);color:var(--color-accent-purple);border-radius:4px" { (ct.as_str().unwrap_or("").replace('_', " ")) }
                                    }
                                }
                            }
                            div style="text-align:right;flex-shrink:0" {
                                p style="font-family:var(--font-mono);font-size:0.7rem;color:var(--color-text-secondary);margin-bottom:0.5rem" { (s(c, "court")) }
                                p style="font-family:var(--font-mono);font-size:0.7rem;color:var(--color-text-secondary)" { (c.get("year").map(template).unwrap_or_default()) }
                                @if let Some(url) = c.get("url").and_then(Value::as_str).filter(|u| !u.is_empty()) {
                                    a href=(url) target="_blank" rel="noopener noreferrer" style="display:block;margin-top:0.75rem;font-size:0.7rem;color:var(--color-accent-purple);text-decoration:underline" { "BAILII →" }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
