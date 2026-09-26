/**
 * Database connection.
 *
 * - Production: `DATABASE_URL` (PostgreSQL) via postgres-js.
 * - Local development without Postgres: PGlite (Postgres compiled to WASM)
 *   persisted to ./data/pglite so state survives restarts.
 * - Tests: PGlite in memory, one database per test file (vitest pool=forks).
 *
 * All three run the same SQL migrations from ./drizzle, so the schema is
 * identical everywhere. Migrations are applied on first use when
 * AUTO_MIGRATE is not "0" (always in dev/test; recommended in production for
 * single-instance deployments, otherwise run `npm run db:migrate` in CI/CD).
 */

import path from "node:path";
import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema> | PgliteDatabase<typeof schema>;

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

interface Holder {
    db: Database | null;
    ready: Promise<Database> | null;
    kind: "postgres" | "pglite" | null;
    close: (() => Promise<void>) | null;
}

// Survive Next.js hot reloads and share across route handlers in one process.
const globalHolder = globalThis as unknown as { __coffeecupDb?: Holder };
const holder: Holder = globalHolder.__coffeecupDb ?? { db: null, ready: null, kind: null, close: null };
globalHolder.__coffeecupDb = holder;

function shouldAutoMigrate(): boolean {
    return process.env.AUTO_MIGRATE !== "0";
}

async function connectPostgres(url: string): Promise<Database> {
    const { default: postgres } = await import("postgres");
    const sql = postgres(url, { max: Number(process.env.DATABASE_POOL_MAX ?? 10), prepare: false });
    const db = drizzlePg(sql, { schema });
    if (shouldAutoMigrate()) {
        const { migrate } = await import("drizzle-orm/postgres-js/migrator");
        await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    }
    holder.close = async () => {
        await sql.end({ timeout: 5 });
    };
    holder.kind = "postgres";
    return db;
}

async function connectPglite(): Promise<Database> {
    const { PGlite } = await import("@electric-sql/pglite");
    const inMemory = process.env.NODE_ENV === "test" || process.env.PGLITE_MEMORY === "1";
    const dataDir = inMemory ? undefined : process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), "data", "pglite");
    const client = dataDir ? new PGlite(dataDir) : new PGlite();
    const db = drizzlePglite(client, { schema });
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    holder.close = async () => {
        await client.close();
    };
    holder.kind = "pglite";
    return db;
}

/** Get the shared database, connecting (and migrating) on first call. */
export function getDb(): Promise<Database> {
    if (holder.db) return Promise.resolve(holder.db);
    if (!holder.ready) {
        const url = process.env.DATABASE_URL;
        holder.ready = (url ? connectPostgres(url) : connectPglite()).then((db) => {
            holder.db = db;
            return db;
        });
        holder.ready.catch(() => {
            holder.ready = null;
        });
    }
    return holder.ready;
}

/** Which backend is active (for health checks and docs). */
export function getDbKind(): "postgres" | "pglite" | null {
    return holder.kind;
}

/** Close and forget the connection (tests, graceful shutdown). */
export async function closeDb(): Promise<void> {
    const close = holder.close;
    holder.db = null;
    holder.ready = null;
    holder.kind = null;
    holder.close = null;
    if (close) await close();
}

export { schema };
