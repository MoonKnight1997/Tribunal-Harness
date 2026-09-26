/**
 * Apply pending SQL migrations from ./drizzle.
 *
 *   DATABASE_URL=postgres://... npm run db:migrate   # hosted Postgres
 *   npm run db:migrate                                # local PGlite (./data/pglite)
 */
import { getDb, closeDb, getDbKind } from "../src/db/client";

async function main() {
    process.env.AUTO_MIGRATE = "1";
    await getDb();
    console.log(`[migrate] migrations applied (${getDbKind()})`);
    await closeDb();
}

main().catch((err) => {
    console.error("[migrate] failed", err);
    process.exit(1);
});
