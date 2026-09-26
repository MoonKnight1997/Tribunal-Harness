/**
 * Object storage abstraction for uploaded documents.
 *
 * Keys are opaque and case-scoped; there are no public URLs. Bytes are only
 * ever served through the authenticated download route after the tenancy
 * guard has passed.
 *
 * Adapters:
 *   - DatabaseStorage (default): bytea rows in Postgres. Simple, transactional,
 *     encrypted at rest by the database host, and adequate for the 10 MB cap.
 *   - LocalDiskStorage: ./data/uploads for local development.
 *   - S3-compatible storage can be added as a third adapter without touching
 *     the document service (see DEPLOYMENT.md).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { documentBlobs } from "@/db/schema";

export interface StorageProvider {
    readonly name: string;
    put(key: string, caseId: string, body: Buffer): Promise<void>;
    get(key: string): Promise<Buffer | null>;
    delete(key: string): Promise<void>;
}

export class DatabaseStorage implements StorageProvider {
    readonly name = "database";
    async put(key: string, caseId: string, body: Buffer): Promise<void> {
        const db = await getDb();
        await db.insert(documentBlobs).values({ storageKey: key, caseId, body });
    }
    async get(key: string): Promise<Buffer | null> {
        const db = await getDb();
        const rows = await db.select({ body: documentBlobs.body }).from(documentBlobs).where(eq(documentBlobs.storageKey, key)).limit(1);
        return rows[0]?.body ?? null;
    }
    async delete(key: string): Promise<void> {
        const db = await getDb();
        await db.delete(documentBlobs).where(eq(documentBlobs.storageKey, key));
    }
}

export class LocalDiskStorage implements StorageProvider {
    readonly name = "local_disk";
    constructor(private readonly root = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "data", "uploads")) {}
    private resolve(key: string): string {
        const safe = key.replace(/[^a-zA-Z0-9/_-]/g, "");
        const full = path.join(this.root, safe);
        if (!full.startsWith(this.root)) throw new Error("Invalid storage key.");
        return full;
    }
    async put(key: string, _caseId: string, body: Buffer): Promise<void> {
        const full = this.resolve(key);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, body, { mode: 0o600 });
    }
    async get(key: string): Promise<Buffer | null> {
        try {
            return await fs.readFile(this.resolve(key));
        } catch {
            return null;
        }
    }
    async delete(key: string): Promise<void> {
        await fs.rm(this.resolve(key), { force: true });
    }
}

let storage: StorageProvider | null = null;

export function getStorage(): StorageProvider {
    if (storage) return storage;
    storage = process.env.STORAGE_PROVIDER === "local_disk" ? new LocalDiskStorage() : new DatabaseStorage();
    return storage;
}

export function setStorageForTests(provider: StorageProvider | null): void {
    storage = provider;
}
