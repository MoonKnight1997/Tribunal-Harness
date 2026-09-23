//! Verified Authorities — known-good case law database. Port of
//! `src/lib/verified-authorities.ts`, values verbatim (including the entries
//! `corpus/authorities/MANIFEST.md` flags for owner review — see DECISIONS.md).

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Court {
    UKSC,
    UKHL,
    EWCA,
    EAT,
    ET,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Binding,
    Persuasive,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedAuthority {
    /// Short case name for matching (e.g. "Polkey")
    pub short_name: &'static str,
    /// Full neutral citation (e.g. "[1987] UKHL 8")
    pub neutral_citation: &'static str,
    pub full_name: &'static str,
    pub court: Court,
    pub tier: Tier,
    pub claim_types: &'static [&'static str],
    pub principle: &'static str,
}

const fn a(
    short_name: &'static str,
    neutral_citation: &'static str,
    full_name: &'static str,
    court: Court,
    tier: Tier,
    claim_types: &'static [&'static str],
    principle: &'static str,
) -> VerifiedAuthority {
    VerifiedAuthority { short_name, neutral_citation, full_name, court, tier, claim_types, principle }
}

pub const VERIFIED_AUTHORITIES: [VerifiedAuthority; 24] = [
    // UNFAIR DISMISSAL — Core Authorities
    a("Polkey", "[1987] UKHL 8", "Polkey v AE Dayton Services Ltd", Court::UKHL, Tier::Binding, &["unfair_dismissal"],
        "Procedural fairness is essential. A dismissal may be unfair solely because the employer failed to follow a fair procedure, even if the outcome would have been the same."),
    a("BHS v Burchell", "[1978] UKEAT 0108_78_2007", "British Home Stores Ltd v Burchell", Court::EAT, Tier::Binding, &["unfair_dismissal"],
        "Three-stage test for misconduct dismissals: (1) genuine belief in guilt, (2) reasonable grounds for that belief, (3) reasonable investigation."),
    a("Iceland Frozen Foods", "[1982] UKEAT 0062_82_2207", "Iceland Frozen Foods Ltd v Jones", Court::EAT, Tier::Binding, &["unfair_dismissal"],
        "The band of reasonable responses test: the tribunal must not substitute its own view for that of the employer. The question is whether the dismissal fell within the range of reasonable responses open to a reasonable employer."),
    a("Williams v Compair Maxam", "[1982] ICR 156", "Williams v Compair Maxam Ltd", Court::EAT, Tier::Binding, &["unfair_dismissal"],
        "Five principles for fair redundancy selection: (1) maximum warning, (2) fair selection criteria, (3) objective application, (4) consultation, (5) consider alternative employment."),
    a("Western Excavating", "[1978] ICR 221", "Western Excavating (ECC) Ltd v Sharp", Court::EWCA, Tier::Binding, &["unfair_dismissal"],
        "Constructive dismissal requires a fundamental breach of contract by the employer, not merely unreasonable behaviour. The contract test, not the reasonableness test, applies."),
    // DISCRIMINATION — Core Authorities
    a("Shamoon", "[2003] UKHL 11", "Shamoon v Chief Constable of the Royal Ulster Constabulary", Court::UKHL, Tier::Binding, &["direct_discrimination"],
        "Detriment means placing the claimant at a disadvantage. A reasonable worker would or might consider the treatment detrimental. It does not require financial loss."),
    a("Igen v Wong", "[2005] EWCA Civ 142", "Igen Ltd v Wong", Court::EWCA, Tier::Binding,
        &["direct_discrimination", "indirect_discrimination", "harassment", "victimisation"],
        "Two-stage burden of proof: (1) claimant proves facts from which the tribunal could conclude discrimination occurred, (2) burden shifts to respondent to prove a non-discriminatory explanation."),
    a("Anya v University of Oxford", "[2001] EWCA Civ 405", "Anya v University of Oxford", Court::EWCA, Tier::Binding, &["direct_discrimination"],
        "Tribunals must consider the totality of the evidence, not just individual incidents in isolation, when determining whether discrimination has occurred."),
    a("Essop", "[2017] UKSC 27", "Essop v Home Office", Court::UKSC, Tier::Binding, &["indirect_discrimination"],
        "Claimant need not show why the PCP puts the group at a disadvantage. Statistical evidence of group disadvantage is sufficient. The reason for the disadvantage is irrelevant to establishing the prima facie case."),
    a("Homer", "[2012] UKSC 15", "Homer v Chief Constable of West Yorkshire Police", Court::UKSC, Tier::Binding, &["indirect_discrimination"],
        "Justification under indirect discrimination requires the employer to show a legitimate aim and that the PCP is a proportionate means of achieving it. Cost alone cannot justify discrimination."),
    // HARASSMENT
    a("Pemberton", "[2018] EWCA Civ 564", "Pemberton v Inwood", Court::EWCA, Tier::Binding, &["harassment"],
        "For harassment, the tribunal must consider both the subjective perception of the claimant and whether it is objectively reasonable for the conduct to have that effect. Context matters."),
    a("Richmond Pharmacology", "[2009] UKEAT 0458_08_2403", "Richmond Pharmacology v Dhaliwal", Court::EAT, Tier::Binding, &["harassment"],
        "Three elements of harassment under EA 2010 s26: (1) unwanted conduct, (2) related to a protected characteristic, (3) having the purpose or effect of violating dignity or creating an intimidating, hostile, degrading, humiliating or offensive environment."),
    // VICTIMISATION
    a("Derbyshire", "[2007] UKHL 16", "Derbyshire v St Helens Metropolitan Borough Council", Court::UKHL, Tier::Binding, &["victimisation"],
        "Victimisation covers detriment because the worker has done a protected act. The employer's honest and reasonable steps to protect their litigation position may not constitute victimisation, but intimidation or threats will."),
    // REASONABLE ADJUSTMENTS
    a("Environment Agency v Rowan", "[2008] UKEAT 0060_07_2908", "Environment Agency v Rowan", Court::EAT, Tier::Binding, &["reasonable_adjustments"],
        "Three-step test for reasonable adjustments: (1) identify the PCP/physical feature/auxiliary aid, (2) identify how it places the disabled person at a substantial disadvantage compared to non-disabled persons, (3) identify what adjustment would remove or reduce that disadvantage."),
    a("Archibald", "[2004] UKHL 32", "Archibald v Fife Council", Court::UKHL, Tier::Binding, &["reasonable_adjustments"],
        "The duty to make reasonable adjustments may require positive discrimination — treating the disabled person more favourably — to level the playing field. This is the opposite of the symmetry principle in direct discrimination."),
    // WHISTLEBLOWING
    a("Cavendish Munro", "[2010] UKEAT 0195_09_0202", "Cavendish Munro Professional Risks Management Ltd v Geduld", Court::EAT, Tier::Binding, &["whistleblowing"],
        "A qualifying disclosure must convey information, not merely make an allegation. Stating 'you are in breach of contract' is an allegation; stating 'you have failed to pay me £X which was due on Y date' conveys information."),
    a("Chesterton Global", "[2017] EWCA Civ 979", "Chesterton Global Ltd v Nurmohamed", Court::EWCA, Tier::Binding, &["whistleblowing"],
        "A disclosure can be 'in the public interest' even if the worker's predominant motive is personal. The tribunal should consider: the numbers affected, the nature of the interests, the nature of the wrongdoing, and the identity of the wrongdoer."),
    // WRONGFUL DISMISSAL
    a("Gunton", "[1981] 1 Ch 448", "Gunton v Richmond-upon-Thames London Borough Council", Court::EWCA, Tier::Binding, &["wrongful_dismissal"],
        "Wrongful dismissal is a contractual claim. Damages are limited to the notice period the employee should have received. The employee must mitigate their loss."),
    // REMEDIES & PROCEDURE
    a("Vento", "[2002] EWCA Civ 1871", "Vento v Chief Constable of West Yorkshire Police (No 2)", Court::EWCA, Tier::Binding,
        &["direct_discrimination", "indirect_discrimination", "harassment", "victimisation"],
        "Three bands for injury to feelings awards in discrimination cases. Updated annually by Presidential Guidance. Current (2024-25): lower band £1,200-£11,200; middle band £11,200-£33,700; upper band £33,700-£56,200; exceptional cases above upper band."),
    a("Chagger", "[2009] EWCA Civ 1176", "Chagger v Abbey National plc", Court::EWCA, Tier::Binding, &["unfair_dismissal", "direct_discrimination"],
        "In discrimination cases, the Polkey percentage reduction principle applies. Compensation may be reduced by the chance that the claimant would have been dismissed in any event, even without the discrimination."),
    a("Kucukdeveci", "C-555/07", "Kucukdeveci v Swedex GmbH", Court::EWCA, Tier::Persuasive, &["direct_discrimination"],
        "EU principle of non-discrimination on grounds of age is a general principle of EU law. National courts must disapply domestic legislation that conflicts, even in disputes between private parties."),
    // ACAS & TIME LIMITS
    a("Robertson v Bexley", "[2003] EWCA Civ 1012", "Robertson v Bexley Community Centre", Court::EWCA, Tier::Binding,
        &["unfair_dismissal", "direct_discrimination", "indirect_discrimination", "harassment"],
        "Time limits in employment tribunals are strictly enforced. An extension of time is the exception, not the rule. The burden is on the claimant to show it was not reasonably practicable to present the claim in time (unfair dismissal) or that it is just and equitable to extend (discrimination)."),
    // FIRE AND REHIRE (ERA 2025)
    a("Tesco v USDAW", "[2024] UKSC 28", "Tesco Stores Ltd v Union of Shop, Distributive and Allied Workers", Court::UKSC, Tier::Binding, &["fire_and_rehire", "unfair_dismissal"],
        "Where a contractual term confers a permanent right (e.g. retained pay), the employer cannot circumvent it by dismissing and re-engaging on inferior terms. An injunction may be granted to prevent the employer from terminating employment for this purpose."),
    a("Khatun v Winn", "[2024] EAT 111", "Khatun v Winn Solicitors Ltd", Court::EAT, Tier::Persuasive, &["fire_and_rehire", "unfair_dismissal"],
        "Fire and rehire as a tactic to impose inferior terms may render a dismissal unfair under ERA 1996 s98, even before ERA 2025 made it automatically unfair. The employer must demonstrate genuine business necessity."),
];

/// Look up by short name, case-insensitively (exact).
pub fn find_authority_by_short_name(name: &str) -> Option<&'static VerifiedAuthority> {
    let lower = name.to_lowercase();
    VERIFIED_AUTHORITIES.iter().find(|a| a.short_name.to_lowercase() == lower)
}

/// First authority whose short name or full name occurs (case-insensitively)
/// inside `text`, in list order — shortName checked before fullName per entry.
pub fn find_authority_by_partial_match(text: &str) -> Option<&'static VerifiedAuthority> {
    let lower = text.to_lowercase();
    VERIFIED_AUTHORITIES
        .iter()
        .find(|a| lower.contains(&a.short_name.to_lowercase()) || lower.contains(&a.full_name.to_lowercase()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn integrity() {
        let mut names: Vec<&str> = VERIFIED_AUTHORITIES.iter().map(|a| a.short_name).collect();
        let n = names.len();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), n);
        for a in VERIFIED_AUTHORITIES.iter() {
            assert!(!a.neutral_citation.trim().is_empty());
            assert!(!a.claim_types.is_empty());
            assert!(!a.full_name.trim().is_empty() && !a.principle.trim().is_empty());
        }
    }

    #[test]
    fn lookups() {
        assert_eq!(find_authority_by_short_name("polkey").unwrap().short_name, "Polkey");
        assert_eq!(find_authority_by_short_name("POLKEY").unwrap().short_name, "Polkey");
        assert!(find_authority_by_short_name("Nonexistent Case Name").is_none());
        assert_eq!(find_authority_by_partial_match("The tribunal relied on Polkey in its reasoning.").unwrap().short_name, "Polkey");
        assert_eq!(find_authority_by_partial_match("See Polkey v AE Dayton Services Ltd for the principle.").unwrap().short_name, "Polkey");
        assert!(find_authority_by_partial_match("This text mentions no known case.").is_none());
    }
}
