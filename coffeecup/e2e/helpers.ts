import { expect, type Page } from "@playwright/test";

/** Unique synthetic account per test; never a real address. */
export function syntheticEmail(prefix = "pilot"): string {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.invalid`;
}

export const PASSWORD = "a strong password for testing";

/** Create an account through the real sign-up page and land in the app shell. */
export async function signUp(page: Page, email = syntheticEmail()): Promise<string> {
    await page.goto("/sign-up");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/^password/i).first().fill(PASSWORD);
    const terms = page.getByRole("checkbox").first();
    if (await terms.count()) await terms.check();
    await page.getByRole("button", { name: /create|sign up/i }).click();
    await expect(page).toHaveURL(/\/app/);
    return email;
}

/** Press Tab until the focused element matches, guarding against infinite loops. */
export async function tabTo(page: Page, matcher: (text: string) => boolean, maxTabs = 60): Promise<void> {
    for (let i = 0; i < maxTabs; i++) {
        const text = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText ?? (document.activeElement as HTMLInputElement | null)?.getAttribute("aria-label") ?? "");
        if (matcher(text)) return;
        await page.keyboard.press("Tab");
    }
    throw new Error("Element not reachable by keyboard");
}
