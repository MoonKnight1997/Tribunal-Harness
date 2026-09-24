import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "cc_session";

/**
 * Edge middleware: send signed-out visitors away from the authenticated app
 * shell. This is a UX convenience only — every server action and API route
 * validates the session against the database itself.
 */
export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;
    if (pathname.startsWith("/app")) {
        const hasCookie = !!request.cookies.get(SESSION_COOKIE)?.value;
        if (!hasCookie) {
            const url = request.nextUrl.clone();
            url.pathname = "/sign-in";
            url.searchParams.set("next", pathname);
            return NextResponse.redirect(url);
        }
    }
    return NextResponse.next();
}

export const config = {
    matcher: ["/app/:path*"],
};
