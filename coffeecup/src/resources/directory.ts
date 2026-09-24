/**
 * Resource directory — clearly differentiated external support routes.
 *
 * No leads are sold, no referral fees are taken, and no case data is sent to
 * any listed organisation. Any future referral commercialisation must live
 * behind ENABLE_EXTERNAL_CASE_REFERRAL in a separate module.
 */

export type ResourceCategory = "official" | "free_general_advice" | "pro_bono_legal" | "regulated_solicitors" | "union_insurance" | "self_representation" | "commercial";

export interface Resource {
    id: string;
    name: string;
    category: ResourceCategory;
    url: string;
    description: string;
    jurisdiction: Array<"england_wales" | "scotland" | "northern_ireland" | "uk">;
    /** Situations where this resource is especially relevant. */
    relevantTo: string[];
    cost: "free" | "free_if_eligible" | "member_benefit" | "paid";
    lastReviewedAt: string;
}

export const RESOURCE_CATEGORY_LABELS: Record<ResourceCategory, { label: string; plain: string }> = {
    official: { label: "Official information", plain: "Government, Acas and tribunal sources." },
    free_general_advice: { label: "Free general advice", plain: "Independent advice services open to everyone." },
    pro_bono_legal: { label: "Free legal help", plain: "Charities and volunteer lawyers, usually with eligibility criteria." },
    regulated_solicitors: { label: "Regulated solicitors", plain: "Find a regulated employment solicitor. Fees apply unless legal aid or a no-win-no-fee agreement is available." },
    union_insurance: { label: "Union and insurance routes", plain: "If you are a union member or have legal expenses insurance, check these first." },
    self_representation: { label: "Self-representation support", plain: "Help for people representing themselves." },
    commercial: { label: "Commercial services", plain: "Paid services. Listed for completeness; no recommendation is implied." },
};

const REVIEWED = "2026-09-24";

export const RESOURCES: Resource[] = [
    { id: "acas", name: "Acas", category: "official", url: "https://www.acas.org.uk/", description: "Free, impartial advice on workplace rights, rules and best practice. Runs Early Conciliation. Helpline 0300 123 1100.", jurisdiction: ["england_wales", "scotland"], relevantTo: ["grievance", "disciplinary", "appeal", "acas_early_conciliation", "dismissal", "pay"], cost: "free", lastReviewedAt: REVIEWED },
    { id: "govuk_et", name: "GOV.UK — Employment tribunals", category: "official", url: "https://www.gov.uk/employment-tribunals", description: "Official guidance and the online service for making a claim (ET1).", jurisdiction: ["england_wales", "scotland"], relevantTo: ["considering_tribunal", "et1_preparation"], cost: "free", lastReviewedAt: REVIEWED },
    { id: "govuk_dismissal", name: "GOV.UK — Dismissal: your rights", category: "official", url: "https://www.gov.uk/dismissal", description: "Official summary of fair and unfair dismissal, notice and redundancy rights.", jurisdiction: ["england_wales", "scotland"], relevantTo: ["dismissal", "redundancy"], cost: "free", lastReviewedAt: REVIEWED },
    { id: "lra_ni", name: "Labour Relations Agency (Northern Ireland)", category: "official", url: "https://www.lra.org.uk/", description: "Northern Ireland's equivalent of Acas, including early conciliation for Industrial Tribunal claims.", jurisdiction: ["northern_ireland"], relevantTo: ["grievance", "disciplinary", "dismissal", "acas_early_conciliation"], cost: "free", lastReviewedAt: REVIEWED },
    { id: "ehrc", name: "Equality Advisory and Support Service (EASS)", category: "official", url: "https://www.equalityadvisoryservice.com/", description: "Advice on discrimination and human rights issues in England, Scotland and Wales.", jurisdiction: ["england_wales", "scotland"], relevantTo: ["discrimination", "disability_adjustments"], cost: "free", lastReviewedAt: REVIEWED },
    { id: "citizens_advice", name: "Citizens Advice", category: "free_general_advice", url: "https://www.citizensadvice.org.uk/work/", description: "Free, confidential advice on work problems, in person, by phone and online.", jurisdiction: ["england_wales"], relevantTo: ["problem_at_work", "grievance", "disciplinary", "dismissal", "pay", "discrimination"], cost: "free", lastReviewedAt: REVIEWED },
    { id: "citizens_advice_scotland", name: "Citizens Advice Scotland", category: "free_general_advice", url: "https://www.citizensadvice.org.uk/scotland/work/", description: "Free advice on work problems in Scotland.", jurisdiction: ["scotland"], relevantTo: ["problem_at_work", "dismissal", "pay"], cost: "free", lastReviewedAt: REVIEWED },
    { id: "law_centres", name: "Law Centres Network", category: "pro_bono_legal", url: "https://www.lawcentres.org.uk/", description: "Find a local Law Centre offering free legal advice and representation to people who cannot afford a lawyer.", jurisdiction: ["england_wales", "scotland", "northern_ireland"], relevantTo: ["considering_tribunal", "et1_preparation", "discrimination", "dismissal"], cost: "free_if_eligible", lastReviewedAt: REVIEWED },
    { id: "lawworks", name: "LawWorks", category: "pro_bono_legal", url: "https://www.lawworks.org.uk/", description: "Network of free legal advice clinics for people who cannot afford a solicitor and are not eligible for legal aid.", jurisdiction: ["england_wales"], relevantTo: ["considering_tribunal", "grievance", "dismissal"], cost: "free_if_eligible", lastReviewedAt: REVIEWED },
    { id: "fru", name: "Free Representation Unit (FRU)", category: "pro_bono_legal", url: "https://www.thefru.org.uk/", description: "Free representation at employment tribunal hearings for clients referred by advice agencies (London and some other areas).", jurisdiction: ["england_wales"], relevantTo: ["et1_preparation", "considering_tribunal"], cost: "free_if_eligible", lastReviewedAt: REVIEWED },
    { id: "elaas", name: "Employment Law Appeal Advice Scheme (ELAAS)", category: "pro_bono_legal", url: "https://www.gov.uk/appeal-employment-appeal-tribunal", description: "Free advice and representation at Employment Appeal Tribunal preliminary hearings.", jurisdiction: ["england_wales", "scotland"], relevantTo: ["et1_preparation"], cost: "free", lastReviewedAt: REVIEWED },
    { id: "sra_find_solicitor", name: "Solicitors Regulation Authority — Find a solicitor (via Law Society)", category: "regulated_solicitors", url: "https://solicitors.lawsociety.org.uk/", description: "Search for regulated solicitors by area of law and location. Check the SRA register for regulation status.", jurisdiction: ["england_wales"], relevantTo: ["considering_tribunal", "et1_preparation", "dismissal", "discrimination"], cost: "paid", lastReviewedAt: REVIEWED },
    { id: "law_society_scotland", name: "Law Society of Scotland — Find a solicitor", category: "regulated_solicitors", url: "https://www.lawscot.org.uk/find-a-solicitor/", description: "Find a regulated solicitor in Scotland.", jurisdiction: ["scotland"], relevantTo: ["considering_tribunal", "dismissal"], cost: "paid", lastReviewedAt: REVIEWED },
    { id: "legal_aid_checker", name: "GOV.UK — Check if you can get legal aid", category: "regulated_solicitors", url: "https://www.gov.uk/check-legal-aid", description: "Legal aid is limited for employment matters but may cover some discrimination cases.", jurisdiction: ["england_wales"], relevantTo: ["discrimination", "disability_adjustments"], cost: "free_if_eligible", lastReviewedAt: REVIEWED },
    { id: "tuc_union_finder", name: "TUC — Join a union", category: "union_insurance", url: "https://www.tuc.org.uk/join-union", description: "If you are a union member, contact your rep first: unions provide representation at meetings and often legal support for tribunal claims.", jurisdiction: ["uk"], relevantTo: ["grievance", "disciplinary", "appeal", "dismissal"], cost: "member_benefit", lastReviewedAt: REVIEWED },
    { id: "legal_expenses_insurance", name: "Check your home or car insurance for legal expenses cover", category: "union_insurance", url: "https://www.abi.org.uk/", description: "Many household policies include legal expenses insurance that can fund employment claims. Check the policy wording and time limits for notifying a claim.", jurisdiction: ["uk"], relevantTo: ["considering_tribunal", "dismissal"], cost: "member_benefit", lastReviewedAt: REVIEWED },
    { id: "advicenow", name: "Advicenow — Employment", category: "self_representation", url: "https://www.advicenow.org.uk/", description: "Plain-English guides for people representing themselves, including tribunal preparation.", jurisdiction: ["england_wales"], relevantTo: ["considering_tribunal", "et1_preparation"], cost: "free", lastReviewedAt: REVIEWED },
    { id: "support_through_court", name: "Support Through Court", category: "self_representation", url: "https://www.supportthroughcourt.org/", description: "Practical and emotional support for people facing court or tribunal without a lawyer.", jurisdiction: ["england_wales"], relevantTo: ["et1_preparation"], cost: "free", lastReviewedAt: REVIEWED },
    { id: "commercial_claims_services", name: "Commercial claims-management and paid self-representation services", category: "commercial", url: "https://www.gov.uk/guidance/claims-management-companies", description: "Paid services exist. Check regulation (FCA for claims management), fees, and what you would give up. No service is recommended here.", jurisdiction: ["england_wales", "scotland"], relevantTo: ["considering_tribunal"], cost: "paid", lastReviewedAt: REVIEWED },
];

export function resourcesFor(opts: { jurisdiction: string; tags: string[]; categories?: ResourceCategory[] }): Resource[] {
    const j = opts.jurisdiction as Resource["jurisdiction"][number];
    return RESOURCES.filter((r) => (r.jurisdiction.includes("uk") || r.jurisdiction.includes(j)) && (!opts.categories || opts.categories.includes(r.category)))
        .map((r) => ({ r, score: r.relevantTo.filter((t) => opts.tags.includes(t)).length }))
        .sort((a, b) => b.score - a.score || a.r.category.localeCompare(b.r.category))
        .map((x) => x.r);
}
