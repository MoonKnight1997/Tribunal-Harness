"use client";

/** Tiny client for the JSON API with friendly error messages. */
export class ApiError extends Error {
    constructor(message: string, readonly status: number, readonly code?: string, readonly details?: unknown) {
        super(message);
    }
}

export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown; form?: FormData }): Promise<T> {
    const res = await fetch(path, {
        method: init?.method ?? (init?.body || init?.form ? "POST" : "GET"),
        headers: init?.form ? undefined : init?.body !== undefined ? { "content-type": "application/json" } : undefined,
        body: init?.form ?? (init?.body !== undefined ? JSON.stringify(init.body) : undefined),
        credentials: "same-origin",
    });
    const text = await res.text();
    let data: unknown = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = null;
    }
    if (!res.ok) {
        const d = (data ?? {}) as { error?: string; code?: string; details?: unknown };
        throw new ApiError(d.error ?? `Request failed (${res.status}).`, res.status, d.code, d.details);
    }
    return data as T;
}

export function errorMessage(err: unknown): string {
    if (err instanceof ApiError) return err.message;
    if (err instanceof Error) return err.message;
    return "Something went wrong. Please try again.";
}
