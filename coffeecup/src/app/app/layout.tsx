import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND, LEGAL_INFORMATION_DISCLAIMER } from "@/brand/config";
import { getCurrentUser } from "@/auth/current-user";
import { SignOutButton } from "@/components/shell/SignOutButton";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
    const user = await getCurrentUser();
    if (!user) redirect("/sign-in?next=/app");
    return (
        <div className="flex min-h-screen flex-col">
            <header className="border-b border-line bg-surface">
                <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
                    <div className="flex items-center gap-4">
                        <Link href="/app" className="font-semibold no-underline text-ink">
                            {BRAND.name}
                        </Link>
                        <Link href="/app" className="text-[15px] text-ink-muted no-underline hover:text-ink">
                            My cases
                        </Link>
                        <Link href="/help" className="text-[15px] text-ink-muted no-underline hover:text-ink">
                            Help
                        </Link>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-ink-muted">
                        <span className="hidden sm:inline">{user.displayName ?? user.email}</span>
                        <SignOutButton />
                    </div>
                </div>
            </header>
            <main className="flex-1">{children}</main>
            <footer className="border-t border-line px-4 py-4 text-center text-xs text-ink-muted">{LEGAL_INFORMATION_DISCLAIMER}</footer>
        </div>
    );
}
