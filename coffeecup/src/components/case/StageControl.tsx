"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/components/api";
import { Button, Select } from "@/components/ui";
import { STAGES } from "@/cases/stages";

export function StageControl({ caseId, stage }: { caseId: string; stage: string }) {
    const router = useRouter();
    const [value, setValue] = useState(stage);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const changed = value !== stage;
    return (
        <div className="flex flex-wrap items-end gap-2">
            <label className="block">
                <span className="block text-sm text-ink-muted">Change where you are</span>
                <Select value={value} onChange={(e) => setValue(e.target.value)} className="w-auto">
                    {STAGES.map((s) => (
                        <option key={s.id} value={s.id}>
                            {s.label}
                        </option>
                    ))}
                </Select>
            </label>
            {changed && (
                <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={async () => {
                        setBusy(true);
                        setError(null);
                        try {
                            await api(`/api/cases/${caseId}`, { method: "PATCH", body: { stage: value } });
                            router.refresh();
                        } catch (err) {
                            setError(errorMessage(err));
                        } finally {
                            setBusy(false);
                        }
                    }}
                >
                    Update
                </Button>
            )}
            {error && <span className="text-sm text-urgent">{error}</span>}
        </div>
    );
}
