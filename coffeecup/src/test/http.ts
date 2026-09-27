/**
 * HTTP test harness — exercise Next.js route handlers in Vitest without a
 * browser, a server or a session cookie.
 *
 * Usage (in a *.test.ts file):
 *
 *   import { vi } from "vitest";
 *   // vi.mock is hoisted above the imports below, so the route module (and
 *   // everything it imports) sees the mocked auth from the start.
 *   vi.mock("@/auth/current-user", async () => (await import("@/test/http")).currentUserMock());
 *   vi.mock("next/headers", async () => (await import("@/test/http")).nextHeadersMock());
 *
 *   import * as route from "@/app/api/cases/[caseId]/[[...path]]/route";
 *   import { asUser, callRoute } from "@/test/http";
 *
 *   asUser(alice.userId, "alice@example.com");
 *   const res = await callRoute(route, { method: "POST", caseId, path: ["events"], body: { date: "2026-01-01", title: "x" } });
 *   expect(res.status).toBe(201);
 *   expect(res.json.event.title).toBe("x");
 *
 * Why the mock lives in the test file: `vi.mock` is hoisted to the top of the
 * file that calls it, and only that file's module graph is affected. A helper
 * module cannot register the mock on the test's behalf, so the test declares
 * the two `vi.mock` lines and delegates the factories to this module. The
 * `next/headers` mock makes `cookies()` throw, which proves the real cookie
 * path is never reached while the harness is active (a request-scope API
 * would otherwise fail outside a Next.js request anyway).
 *
 * `asUser` switches the signed-in actor between calls; `asAnonymous` makes
 * `requireUser` throw UnauthenticatedError (401).
 */

import { NextRequest, type NextResponse } from "next/server";
import { UnauthenticatedError } from "@/lib/errors";
import type { Actor } from "@/cases/access";

export interface HarnessUser {
    id: string;
    email: string;
    displayName: string | null;
    createdAt: Date;
}

let current: HarnessUser | null = null;

/** Sign in as this user for subsequent handler calls. */
export function asUser(userId: string, email: string, displayName: string | null = null): void {
    current = { id: userId, email, displayName, createdAt: new Date() };
}

/** Make subsequent calls unauthenticated. */
export function asAnonymous(): void {
    current = null;
}

/** Factory for `vi.mock("@/auth/current-user", ...)`. */
export function currentUserMock(): {
    getCurrentUser: () => Promise<HarnessUser | null>;
    requireUser: () => Promise<{ user: HarnessUser; actor: Actor }>;
} {
    return {
        getCurrentUser: async () => current,
        requireUser: async () => {
            if (!current) throw new UnauthenticatedError();
            return { user: current, actor: { userId: current.id } };
        },
    };
}

/** Factory for `vi.mock("next/headers", ...)`: any cookie access is a harness violation. */
export function nextHeadersMock(): { cookies: () => never; headers: () => never } {
    const fail = (): never => {
        throw new Error("next/headers was called under the HTTP test harness; auth must come from the mocked requireUser().");
    };
    return { cookies: fail, headers: fail };
}

export type RouteMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

type Handler = (request: NextRequest, ctx: { params: Promise<{ caseId: string; path?: string[] }> }) => Promise<NextResponse | Response>;

export type RouteModule = Partial<Record<RouteMethod, Handler>>;

export interface CallOptions {
    method: RouteMethod;
    caseId: string;
    /** Sub-resource path segments, e.g. ["events", eventId]. */
    path?: string[];
    /** JSON body (serialised) — or a raw string to send malformed JSON. */
    body?: unknown;
    /** Multipart body; takes precedence over `body`. */
    form?: FormData;
    query?: Record<string, string>;
    headers?: Record<string, string>;
}

export interface CallResult {
    status: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    json: any;
    text: string;
    headers: Headers;
}

export function buildRequest(opts: CallOptions): NextRequest {
    const segs = [opts.caseId, ...(opts.path ?? [])].map(encodeURIComponent).join("/");
    const url = new URL(`http://localhost/api/cases/${segs}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    const headers = new Headers(opts.headers ?? {});
    let body: BodyInit | undefined;
    if (opts.form) {
        body = opts.form;
    } else if (opts.body !== undefined) {
        body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
        if (!headers.has("content-type")) headers.set("content-type", "application/json");
    }
    return new NextRequest(url, { method: opts.method, headers, body });
}

/** Invoke the handler for `opts.method` exported by a route module. */
export async function callRoute(route: RouteModule, opts: CallOptions): Promise<CallResult> {
    const handler = route[opts.method];
    if (!handler) throw new Error(`Route module does not export ${opts.method}`);
    const request = buildRequest(opts);
    const res = await handler(request, { params: Promise.resolve({ caseId: opts.caseId, path: opts.path ?? [] }) });
    const text = await res.text();
    let parsed: unknown = null;
    try {
        parsed = text ? JSON.parse(text) : null;
    } catch {
        parsed = null;
    }
    return { status: res.status, json: parsed, text, headers: res.headers };
}
