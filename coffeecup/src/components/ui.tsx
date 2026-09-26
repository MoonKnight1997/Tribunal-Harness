import Link from "next/link";
import type { ReactNode } from "react";
import { LEGAL_INFORMATION_DISCLAIMER } from "@/brand/config";

export function cx(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(" ");
}

export function Container({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cx("mx-auto w-full max-w-5xl px-4 sm:px-6", className)}>{children}</div>;
}

export function PageHeader({ eyebrow, title, intro, actions }: { eyebrow?: string; title: string; intro?: ReactNode; actions?: ReactNode }) {
    return (
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
                {eyebrow && <p className="mb-1 text-sm font-medium uppercase tracking-wide text-ink-muted">{eyebrow}</p>}
                <h1 className="text-3xl font-semibold leading-tight tracking-tight">{title}</h1>
                {intro && <div className="mt-2 max-w-2xl text-ink-muted">{intro}</div>}
            </div>
            {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
    );
}

export function Card({ children, className, title, aside }: { children: ReactNode; className?: string; title?: ReactNode; aside?: ReactNode }) {
    return (
        <section className={cx("rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(31,41,51,0.04)]", className)}>
            {(title || aside) && (
                <div className="mb-3 flex items-start justify-between gap-3">
                    {title && <h2 className="text-lg font-semibold">{title}</h2>}
                    {aside}
                </div>
            )}
            {children}
        </section>
    );
}

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

const BUTTON_STYLES: Record<ButtonVariant, string> = {
    primary: "bg-accent text-white hover:bg-accent-strong",
    secondary: "border border-line bg-surface text-ink hover:bg-surface-muted",
    quiet: "text-accent hover:bg-accent-soft",
    danger: "border border-urgent/40 text-urgent hover:bg-urgent-soft",
};

export function Button({ children, variant = "primary", className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
    return (
        <button className={cx("inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-[15px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50", BUTTON_STYLES[variant], className)} {...props}>
            {children}
        </button>
    );
}

export function ButtonLink({ href, children, variant = "primary", className }: { href: string; children: ReactNode; variant?: ButtonVariant; className?: string }) {
    return (
        <Link href={href} className={cx("inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-[15px] font-medium no-underline transition", BUTTON_STYLES[variant], className)}>
            {children}
        </Link>
    );
}

export function Field({ label, hint, children, error }: { label: string; hint?: string; children: ReactNode; error?: string | null }) {
    return (
        <label className="block">
            <span className="block text-[15px] font-medium">{label}</span>
            {hint && <span className="block text-sm text-ink-muted">{hint}</span>}
            <div className="mt-1.5">{children}</div>
            {error && <span className="mt-1 block text-sm text-urgent">{error}</span>}
        </label>
    );
}

const INPUT = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-[16px] text-ink placeholder:text-ink-faint focus:border-accent";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
    return <input className={cx(INPUT, props.className)} {...props} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
    return <textarea className={cx(INPUT, "min-h-[120px]", props.className)} {...props} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
    return <select className={cx(INPUT, props.className)} {...props} />;
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "urgent" | "ok"; title?: string; children: ReactNode }) {
    const styles = {
        info: "border-accent/30 bg-accent-soft text-ink",
        warn: "border-warn/30 bg-warn-soft text-ink",
        urgent: "border-urgent/40 bg-urgent-soft text-ink",
        ok: "border-ok/30 bg-ok-soft text-ink",
    }[tone];
    return (
        <div role={tone === "urgent" ? "alert" : "status"} className={cx("rounded-lg border px-4 py-3 text-[15px]", styles)}>
            {title && <p className="mb-1 font-semibold">{title}</p>}
            <div>{children}</div>
        </div>
    );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "warn" | "urgent" | "ok" }) {
    const styles = {
        neutral: "bg-surface-muted text-ink-muted",
        accent: "bg-accent-soft text-accent-strong",
        warn: "bg-warn-soft text-warn",
        urgent: "bg-urgent-soft text-urgent",
        ok: "bg-ok-soft text-ok",
    }[tone];
    return <span className={cx("inline-block rounded-full px-2.5 py-0.5 text-xs font-medium", styles)}>{children}</span>;
}

export function Disclaimer() {
    return <p className="mt-8 border-t border-line pt-4 text-sm text-ink-muted">{LEGAL_INFORMATION_DISCLAIMER}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
    return <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-ink-muted">{children}</p>;
}
