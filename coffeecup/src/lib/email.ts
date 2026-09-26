/**
 * Transactional email. Provider-agnostic: a console adapter for development
 * and a generic HTTPS JSON adapter (Resend-compatible) for production.
 * Recovery links are the only email the product sends today.
 */

import { BRAND } from "@/brand/config";

export interface EmailMessage {
    to: string;
    subject: string;
    text: string;
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
    const apiKey = process.env.EMAIL_API_KEY;
    const from = process.env.EMAIL_FROM ?? `${BRAND.name} <no-reply@${new URL(BRAND.origin).hostname}>`;
    if (!apiKey) {
        if (process.env.NODE_ENV === "production") {
            console.warn("[email] EMAIL_API_KEY not set; email not sent.");
            return;
        }
        console.log(`[email:dev] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
        return;
    }
    const endpoint = process.env.EMAIL_API_URL ?? "https://api.resend.com/emails";
    const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text }),
    });
    if (!res.ok) console.warn(`[email] provider returned ${res.status}`);
}

export async function sendRecoveryEmail(to: string, link: string): Promise<void> {
    await sendEmail({
        to,
        subject: `Reset your ${BRAND.name} password`,
        text: `Someone asked to reset the password for this ${BRAND.name} account.\n\nIf that was you, open this link within the next hour:\n${link}\n\nIf it was not you, you can ignore this email; nothing has changed.`,
    });
}
