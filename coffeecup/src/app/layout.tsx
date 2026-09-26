import type { Metadata } from "next";
import "./globals.css";
import { BRAND } from "@/brand/config";

export const metadata: Metadata = {
    title: { default: BRAND.name, template: `%s · ${BRAND.name}` },
    description: BRAND.strapline,
    robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en-GB">
            <body>{children}</body>
        </html>
    );
}
