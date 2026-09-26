import Link from "next/link";
import type { ReactNode } from "react";
import { BRAND, LEGAL_INFORMATION_DISCLAIMER } from "@/brand/config";
import { Container } from "@/components/ui";
import { getCurrentUser } from "@/auth/current-user";

export async function PublicShell({ children }: { children: ReactNode }) {
    const user = await getCurrentUser();
    return (
        <div className="flex min-h-screen flex-col">
            <header className="border-b border-line bg-surface">
                <Container className="flex h-16 items-center justify-between gap-4">
                    <Link href="/" className="text-lg font-semibold no-underline text-ink">
                        {BRAND.name}
                    </Link>
                    <nav aria-label="Main" className="flex items-center gap-4 text-[15px]">
                        <Link href="/how-it-works" className="hidden text-ink-muted no-underline hover:text-ink sm:inline">
                            How it works
                        </Link>
                        <Link href="/help" className="text-ink-muted no-underline hover:text-ink">
                            Help
                        </Link>
                        <Link href="/pricing" className="hidden text-ink-muted no-underline hover:text-ink sm:inline">
                            Pricing
                        </Link>
                        {user ? (
                            <Link href="/app" className="rounded-lg bg-accent px-3 py-1.5 text-white no-underline">
                                My cases
                            </Link>
                        ) : (
                            <>
                                <Link href="/sign-in" className="text-ink-muted no-underline hover:text-ink">
                                    Sign in
                                </Link>
                                <Link href="/start" className="rounded-lg bg-accent px-3 py-1.5 text-white no-underline">
                                    Get help
                                </Link>
                            </>
                        )}
                    </nav>
                </Container>
            </header>
            <main className="flex-1 py-10">{children}</main>
            <footer className="border-t border-line bg-surface py-8 text-sm text-ink-muted">
                <Container>
                    <p className="mb-3">{LEGAL_INFORMATION_DISCLAIMER}</p>
                    <div className="flex flex-wrap gap-4">
                        <Link href="/privacy">Privacy</Link>
                        <Link href="/terms">Terms</Link>
                        <Link href="/help">Help and support</Link>
                        <span>Jurisdiction: {BRAND.defaultJurisdictionLabel} (Scotland where stated)</span>
                    </div>
                </Container>
            </footer>
        </div>
    );
}
