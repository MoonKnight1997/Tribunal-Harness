import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
    // Pin the file-tracing root to this app directory so Next does not infer a
    // workspace root from a sibling lockfile.
    outputFileTracingRoot: path.join(__dirname),
    // Server-only native/heavy packages that must not be bundled for the edge.
    serverExternalPackages: ["pdf-parse", "@electric-sql/pglite", "postgres"],
    // Hardening headers for every response. Case data is sensitive: never let a
    // page be framed, sniffed or referrer-leaked.
    async headers() {
        return [
            {
                source: "/(.*)",
                headers: [
                    { key: "X-Frame-Options", value: "DENY" },
                    { key: "X-Content-Type-Options", value: "nosniff" },
                    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
                    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
                ],
            },
        ];
    },
};

export default nextConfig;
