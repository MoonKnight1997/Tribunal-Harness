/**
 * HTTP helpers for route handlers: uniform JSON responses, error mapping and
 * safe request parsing. Business logic never imports Next.js; handlers are
 * thin adapters over services.
 */

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { AppError } from "./errors";

export function json<T>(data: T, init?: ResponseInit): NextResponse {
    return NextResponse.json(data, init);
}

export function errorResponse(err: unknown): NextResponse {
    if (err instanceof AppError) {
        const body: Record<string, unknown> = { error: err.message, code: err.code };
        if (err.details !== undefined && err.status === 400) body.details = err.details;
        return NextResponse.json(body, { status: err.status });
    }
    const requestId = randomUUID();
    console.error(`[api] unhandled error requestId=${requestId}`, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Something went wrong on our side. Please try again; if it keeps happening, quote this reference to support.", code: "internal", requestId }, { status: 500 });
}

/** Wrap a handler so thrown AppErrors become proper responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<NextResponse | Response>): (...args: A) => Promise<NextResponse | Response> {
    return async (...args: A) => {
        try {
            return await fn(...args);
        } catch (err) {
            return errorResponse(err);
        }
    };
}

export async function readJson<T = Record<string, unknown>>(request: Request, maxBytes = 512 * 1024): Promise<T> {
    const text = await request.text();
    if (text.length > maxBytes) throw new AppError("Request body is too large.", 413, "too_large");
    if (!text.trim()) return {} as T;
    try {
        return JSON.parse(text) as T;
    } catch {
        throw new AppError("The request body was not valid JSON.", 400, "bad_json");
    }
}

export function requestOrigin(request: Request): string {
    const configured = process.env.NEXT_PUBLIC_BRAND_ORIGIN;
    if (configured && configured.trim()) return configured.replace(/\/+$/, "");
    const url = new URL(request.url);
    return `${url.protocol}//${url.host}`;
}
