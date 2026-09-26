"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavSection } from "@/cases/stages";
import { cx } from "@/components/ui";

const ITEMS: Array<{ id: NavSection; label: string; path: string }> = [
    { id: "home", label: "Home", path: "" },
    { id: "case", label: "My case", path: "/case" },
    { id: "timeline", label: "Timeline", path: "/timeline" },
    { id: "documents", label: "Documents", path: "/documents" },
    { id: "process", label: "Workplace process", path: "/process" },
    { id: "acas", label: "Acas", path: "/acas" },
    { id: "claims", label: "Claims / Tribunal", path: "/claims" },
    { id: "tasks", label: "Tasks", path: "/tasks" },
    { id: "exports", label: "Exports", path: "/exports" },
    { id: "help", label: "Help", path: "/help" },
];

export function CaseNav({ caseId, sections, title }: { caseId: string; sections: NavSection[]; title: string }) {
    const pathname = usePathname();
    const base = `/app/cases/${caseId}`;
    return (
        <nav aria-label="Case sections" className="border-b border-line bg-surface">
            <div className="mx-auto max-w-6xl px-4 sm:px-6">
                <p className="pt-3 text-sm text-ink-muted">Case</p>
                <p className="mb-2 text-xl font-semibold">{title}</p>
                <ul className="-mb-px flex gap-1 overflow-x-auto">
                    {ITEMS.filter((i) => sections.includes(i.id)).map((i) => {
                        const href = `${base}${i.path}`;
                        const active = i.path === "" ? pathname === base : pathname.startsWith(href);
                        return (
                            <li key={i.id}>
                                <Link href={href} className={cx("block whitespace-nowrap border-b-2 px-3 py-2 text-[15px] no-underline", active ? "border-accent text-accent-strong" : "border-transparent text-ink-muted hover:text-ink")} aria-current={active ? "page" : undefined}>
                                    {i.label}
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </nav>
    );
}
