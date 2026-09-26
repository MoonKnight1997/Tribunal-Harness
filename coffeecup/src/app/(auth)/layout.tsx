import Link from "next/link";
import { BRAND, LEGAL_INFORMATION_DISCLAIMER } from "@/brand/config";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex min-h-screen flex-col">
            <header className="border-b border-line bg-surface">
                <div className="mx-auto flex h-16 max-w-5xl items-center px-4 sm:px-6">
                    <Link href="/" className="text-lg font-semibold no-underline text-ink">
                        {BRAND.name}
                    </Link>
                </div>
            </header>
            <main className="flex flex-1 items-start justify-center px-4 py-12">
                <div className="w-full max-w-md">{children}</div>
            </main>
            <footer className="px-4 py-6 text-center text-sm text-ink-muted">{LEGAL_INFORMATION_DISCLAIMER}</footer>
        </div>
    );
}
