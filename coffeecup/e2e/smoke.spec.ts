import { test, expect } from "@playwright/test";
import { signUp } from "./helpers";

test.describe("smoke", () => {
    test("liveness endpoint answers and the public start page renders the disclaimer", async ({ page, request }) => {
        const health = await request.get("/api/health");
        expect(health.ok()).toBeTruthy();
        await page.goto("/start");
        await expect(page.getByText(/legal information/i).first()).toBeVisible();
    });

    test("a new account can be created and lands in the app", async ({ page }) => {
        await signUp(page);
        await expect(page.getByRole("heading").first()).toBeVisible();
    });
});
