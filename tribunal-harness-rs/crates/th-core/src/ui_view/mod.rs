//! Pure, DOM-free view helpers behind the UI (ports of
//! `components/adversarial/debate-modes.ts` and the mapping in
//! `components/analysis/AnalysisResultsPanel.tsx`). The server renders result
//! fragments from these, so the logic is testable against fixtures.

pub mod analysis_results;
pub mod debate_modes;
