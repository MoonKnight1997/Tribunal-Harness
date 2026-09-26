"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, errorMessage } from "@/components/api";
import { Button, Card, Field, Input, Notice } from "@/components/ui";

type Mode = "sign-in" | "sign-up" | "recover" | "reset";

const TITLES: Record<Mode, string> = { "sign-in": "Sign in", "sign-up": "Create your account", recover: "Reset your password", reset: "Choose a new password" };

export function AuthForm({ mode }: { mode: Mode }) {
    const router = useRouter();
    const params = useSearchParams();
    const next = params.get("next") ?? "/app";
    const token = params.get("token") ?? "";
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [accepted, setAccepted] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            if (mode === "sign-up") {
                await api("/api/auth/sign-up", { body: { email, password, acceptedTerms: accepted, displayName } });
                router.push(next);
            } else if (mode === "sign-in") {
                await api("/api/auth/sign-in", { body: { email, password } });
                router.push(next);
            } else if (mode === "recover") {
                const res = await api<{ message: string }>("/api/auth/recover", { body: { email } });
                setMessage(res.message);
            } else {
                await api("/api/auth/reset", { body: { token, newPassword: password } });
                router.push("/app");
            }
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    }

    return (
        <Card title={TITLES[mode]}>
            <form onSubmit={submit} className="space-y-4">
                {(mode === "sign-in" || mode === "sign-up" || mode === "recover") && (
                    <Field label="Email">
                        <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                    </Field>
                )}
                {mode === "sign-up" && (
                    <Field label="Your name (optional)" hint="Used on documents you generate.">
                        <Input autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                    </Field>
                )}
                {(mode === "sign-in" || mode === "sign-up" || mode === "reset") && (
                    <Field label={mode === "reset" ? "New password" : "Password"} hint={mode !== "sign-in" ? "At least 10 characters. A few random words work well." : undefined}>
                        <Input type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} required minLength={mode === "sign-in" ? undefined : 10} value={password} onChange={(e) => setPassword(e.target.value)} />
                    </Field>
                )}
                {mode === "sign-up" && (
                    <label className="flex items-start gap-2 text-[15px]">
                        <input type="checkbox" className="mt-1" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} required />
                        <span>
                            I accept the <Link href="/terms">terms</Link> and <Link href="/privacy">privacy notice</Link>, and I understand that details I record about my situation (which may include health or other sensitive information) are processed with my explicit consent so the service can help me.
                        </span>
                    </label>
                )}
                {error && <Notice tone="warn">{error}</Notice>}
                {message && <Notice tone="ok">{message}</Notice>}
                <Button type="submit" disabled={busy} className="w-full">
                    {busy ? "One moment…" : TITLES[mode]}
                </Button>
            </form>
            <div className="mt-4 flex flex-wrap gap-3 text-sm text-ink-muted">
                {mode !== "sign-in" && <Link href="/sign-in">Sign in</Link>}
                {mode !== "sign-up" && <Link href="/sign-up">Create an account</Link>}
                {mode === "sign-in" && <Link href="/recover">Forgotten your password?</Link>}
            </div>
        </Card>
    );
}
