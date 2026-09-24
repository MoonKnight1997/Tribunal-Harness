import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    test: {
        environment: "node",
        include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
        setupFiles: ["src/test/setup.ts"],
        globals: true,
        // Each test file gets its own process and its own in-memory Postgres
        // (PGlite), so database tests never share state.
        pool: "forks",
        testTimeout: 30_000,
        hookTimeout: 60_000,
        coverage: { enabled: false },
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
});
