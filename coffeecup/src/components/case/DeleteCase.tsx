"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/components/api";
import { Button, ButtonLink, Notice } from "@/components/ui";

export function DeleteCase({ caseId }: { caseId: string }) {
    const router = useRouter();
    const [confirmText, setConfirmText] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    return (
        <div className="space-y-3">
            <a className="inline-block text-[15px]" href={`/api/cases/${caseId}/export?format=markdown`}>Download a copy first</a>
            <label className="block text-[15px]">
                Type <strong>delete</strong> to confirm
                <input className="mt-1 block w-full rounded-lg border border-line px-3 py-2" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
            </label>
            {error && <Notice tone="warn">{error}</Notice>}
            <div className="flex gap-2">
                <Button variant="danger" disabled={busy || confirmText !== "delete"} onClick={async () => { setBusy(true); try { await api(`/api/cases/${caseId}/purge`, { method: "POST", body: {} }); router.push("/app"); router.refresh(); } catch (err) { setError(errorMessage(err)); setBusy(false); } }}>Delete permanently</Button>
                <ButtonLink href={`/app/cases/${caseId}`} variant="secondary">Cancel</ButtonLink>
            </div>
        </div>
    );
}
