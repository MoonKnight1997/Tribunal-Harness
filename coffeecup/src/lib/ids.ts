import { randomUUID } from "node:crypto";

/** Application-generated primary key. */
export function newId(): string {
    return randomUUID();
}
