"use client";

import { useRouter } from "next/navigation";
import { api } from "@/components/api";

export function SignOutButton() {
    const router = useRouter();
    return (
        <button
            className="rounded-md px-2 py-1 text-sm text-ink-muted hover:bg-surface-muted"
            onClick={async () => {
                await api("/api/auth/sign-out", { method: "POST", body: {} });
                router.push("/");
                router.refresh();
            }}
        >
            Sign out
        </button>
    );
}
