import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

/**
 * Browser journeys (docs/TESTING.md → "Browser journeys").
 *
 * Runs the real app (`next dev`) on its own port against an in-memory PGlite
 * database with the mock model provider, so every run starts from an empty
 * database and never touches the network. Two projects: desktop keyboard use
 * and a 375 px phone viewport (zoom checks live inside the specs).
 *
 * The Chromium binary: on the hosted CI image and in the cloud sandbox a
 * Chromium build is pre-installed under PLAYWRIGHT_BROWSERS_PATH; when the
 * pinned @playwright/test version wants a different revision we launch the
 * installed binary directly via PLAYWRIGHT_CHROMIUM_EXECUTABLE (defaulting to
 * /opt/pw-browsers/chromium when present). Locally `npx playwright install
 * chromium` once and leave the variable unset.
 */
const PORT = Number(process.env.E2E_PORT ?? 3105);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

export default defineConfig({
    testDir: "./e2e",
    timeout: 60_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
    outputDir: "./e2e-results",
    use: {
        baseURL: BASE_URL,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        launchOptions: executablePath ? { executablePath } : undefined,
    },
    projects: [
        { name: "desktop", use: { ...devices["Desktop Chrome"] } },
        { name: "phone", use: { ...devices["Pixel 7"], hasTouch: true } },
    ],
    webServer: {
        command: `npx next dev --port ${PORT}`,
        url: `${BASE_URL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: {
            NODE_ENV: "development",
            PGLITE_MEMORY: "1",
            LLM_PROVIDER: "mock",
            JOBS_INLINE: "1",
            PAYMENTS_ENABLED: "0",
            ANALYTICS_DISABLED: "1",
            RATE_LIMIT_BACKEND: "memory",
            NEXT_PUBLIC_BRAND_ORIGIN: BASE_URL,
        },
    },
});
