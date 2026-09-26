"use client";

import { useState } from "react";
import { api, errorMessage } from "@/components/api";
import { Button, Notice } from "@/components/ui";

export function Upgrade({ caseId, tier }: { caseId: string; tier: "case_pass" | "claim_pack" }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    return (
        <div>
            {error && <div className="mb-2"><Notice tone="warn">{error}</Notice></div>}
            <Button disabled={busy} onClick={async () => { setBusy(true); setError(null); try { const res = await api<{ url: string }>(`/api/cases/${caseId}/checkout`, { body: { tier } }); window.location.href = res.url; } catch (err) { setError(errorMessage(err)); setBusy(false); } }}>{busy ? "Opening checkout…" : "Continue to payment"}</Button>
        </div>
    );
}
