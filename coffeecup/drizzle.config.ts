import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit configuration.
 *
 * `npm run db:generate` diffs `src/db/schema.ts` against the SQL migrations in
 * `./drizzle` and writes a new migration file. `npm run db:migrate` applies the
 * migrations (see scripts/migrate.ts) against DATABASE_URL, or against the
 * local PGlite data directory when DATABASE_URL is unset.
 */
export default defineConfig({
    dialect: "postgresql",
    schema: "./src/db/schema.ts",
    out: "./drizzle",
    dbCredentials: {
        url: process.env.DATABASE_URL ?? "postgres://localhost:5432/coffeecup",
    },
    strict: true,
    verbose: true,
});
