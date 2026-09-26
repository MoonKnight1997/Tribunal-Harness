/**
 * Typed application errors. Route handlers map these to HTTP status codes in
 * one place (src/lib/http.ts) so business logic never imports Next.js.
 */

export class AppError extends Error {
    readonly status: number;
    readonly code: string;
    readonly details?: unknown;
    constructor(message: string, status: number, code: string, details?: unknown) {
        super(message);
        this.name = "AppError";
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export class NotFoundError extends AppError {
    constructor(what = "Not found") {
        super(what, 404, "not_found");
        this.name = "NotFoundError";
    }
}

export class ForbiddenError extends AppError {
    constructor(message = "You do not have access to this.") {
        super(message, 403, "forbidden");
        this.name = "ForbiddenError";
    }
}

export class UnauthenticatedError extends AppError {
    constructor(message = "Please sign in.") {
        super(message, 401, "unauthenticated");
        this.name = "UnauthenticatedError";
    }
}

export class ValidationError extends AppError {
    constructor(message: string, details?: unknown) {
        super(message, 400, "validation", details);
        this.name = "ValidationError";
    }
}

export class FeatureDisabledError extends AppError {
    constructor(flag: string) {
        super(`This feature is not enabled (${flag}).`, 404, "feature_disabled", { flag });
        this.name = "FeatureDisabledError";
    }
}

export class EntitlementRequiredError extends AppError {
    constructor(tier: string) {
        super(`This feature needs the ${tier.replace("_", " ")}.`, 402, "entitlement_required", { tier });
        this.name = "EntitlementRequiredError";
    }
}

export class RateLimitedError extends AppError {
    constructor(message = "Too many requests. Please try again shortly.") {
        super(message, 429, "rate_limited");
        this.name = "RateLimitedError";
    }
}

export class ProviderError extends AppError {
    constructor(message: string, details?: unknown) {
        super(message, 502, "provider_error", details);
        this.name = "ProviderError";
    }
}
