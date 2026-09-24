/**
 * Acas Code of Practice versions.
 *
 * A process is governed by the Code in force when it STARTED. A draft or
 * future Code is never applied to a historical or current process. If a new
 * Code is issued, add a row with its effectiveFrom and (optionally) close the
 * previous row's effectiveTo; do not edit the existing row.
 */

export interface AcasCodeVersion {
    id: string;
    title: string;
    sourceKey: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    /** Not yet in force: never selected automatically. */
    draft: boolean;
    keyPoints: string[];
}

export const ACAS_CODE_VERSIONS: AcasCodeVersion[] = [
    {
        id: "acas_code_2015",
        title: "Acas Code of Practice on disciplinary and grievance procedures (2015)",
        sourceKey: "acas_code_2015",
        effectiveFrom: "2015-03-11",
        effectiveTo: null,
        draft: false,
        keyPoints: [
            "Raise issues promptly and without unreasonable delay.",
            "Employers should investigate before deciding, and tell the employee the case against them.",
            "The employee has the right to be accompanied at disciplinary and grievance meetings.",
            "The employee should be given the chance to put their case and to appeal any formal decision.",
            "An unreasonable failure to follow the Code can lead a tribunal to adjust compensation by up to 25%.",
        ],
    },
];

export function acasCodeForDate(startDate: string): AcasCodeVersion {
    const applicable = ACAS_CODE_VERSIONS.filter((v) => !v.draft && startDate >= v.effectiveFrom && (v.effectiveTo === null || startDate <= v.effectiveTo));
    // Latest applicable by effectiveFrom.
    applicable.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
    return applicable[0] ?? ACAS_CODE_VERSIONS[0];
}

export function acasCodeById(id: string | null | undefined): AcasCodeVersion | null {
    return ACAS_CODE_VERSIONS.find((v) => v.id === id) ?? null;
}
