import { handle, json } from "@/lib/http";
import { requireUser } from "@/auth/current-user";
import { deleteAccount } from "@/cases/retention";
import { clearSessionCookie } from "@/auth/cookies";

export const GET = handle(async () => {
    const { user } = await requireUser();
    return json({ user });
});

/** Delete the account and every case, document and entitlement it owns. */
export const DELETE = handle(async () => {
    const { user } = await requireUser();
    await deleteAccount(user.id);
    await clearSessionCookie();
    return json({ ok: true });
});
