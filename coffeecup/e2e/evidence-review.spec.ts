import { test, expect, type Page } from "@playwright/test";
import { signUp } from "./helpers";

/**
 * Evidence inbox: everything read from a document waits in /review with the
 * source passage beside it. Desktop drives the queue from the keyboard; the
 * phone project checks the stacked layout and that nothing overflows.
 */

const INVITE = "Dear Sam, You are invited to attend a disciplinary hearing on 3 March 2026. The allegation: that you were absent without authorisation on 14 January 2026. It is alleged that you failed to follow the absence procedure.";

async function seedCase(page: Page): Promise<string> {
    const created = await page.request.post("/api/cases", { data: { entryRoute: "disciplinary" } });
    expect(created.status(), await created.text()).toBe(201);
    const { caseId } = (await created.json()) as { caseId: string };
    const proc = await page.request.post(`/api/cases/${caseId}/processes`, { data: { type: "disciplinary" } });
    expect(proc.status()).toBe(201);
    const { process } = (await proc.json()) as { process: { id: string } };
    const upload = await page.request.post(`/api/cases/${caseId}/documents`, {
        multipart: { file: { name: "invite.txt", mimeType: "text/plain", buffer: Buffer.from(INVITE) }, processId: process.id },
    });
    expect(upload.status(), await upload.text()).toBe(201);
    return caseId;
}

function remaining(page: Page) {
    return page.getByTestId("remaining-count");
}

async function readRemaining(page: Page): Promise<number> {
    const text = (await remaining(page).textContent()) ?? "";
    const m = /^(\d+) item/.exec(text.trim());
    return m ? Number(m[1]) : 0;
}

test.describe("evidence inbox", () => {
    test.setTimeout(180_000);

    test("proposals from a document can be reviewed from the keyboard, with the passage highlighted", async ({ page }, testInfo) => {
        await signUp(page);
        const caseId = await seedCase(page);
        await page.goto(`/app/cases/${caseId}/review`);

        await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
        const total = await readRemaining(page);
        expect(total).toBeGreaterThanOrEqual(3); // two events and two allegations from the mock extractor
        await expect(page.getByTestId("nav-count-review")).toHaveText(new RegExp(`^${total}`));

        // The first item is selected with visible focus, and its passage is shown with the match highlighted.
        const items = page.getByTestId("review-item");
        await expect(items.first()).toHaveAttribute("aria-selected", "true");
        await expect(items.first()).toBeFocused();
        const excerpt = page.locator('[data-testid="excerpt"]:visible');
        await expect(excerpt).toHaveCount(1);
        await expect(excerpt.locator("mark")).toBeVisible();
        await expect(excerpt).toContainText(/3 March 2026|absent without authorisation|absence procedure/);
        await expect(page.getByText(/Passage found in invite\.txt/).first()).toBeVisible();
        // No model confidence anywhere on the page.
        await expect(page.locator("body")).not.toContainText(/confidence|\d+%/);

        // Provenance labels separate "the document says" from "the employer alleges".
        await expect(page.getByText("The document says").first()).toBeVisible();
        await expect(page.getByText("The employer alleges").first()).toBeVisible();

        // Keyboard: j moves down, k moves up.
        await page.keyboard.press("j");
        await expect(items.nth(1)).toHaveAttribute("aria-selected", "true");
        await page.keyboard.press("k");
        await expect(items.first()).toHaveAttribute("aria-selected", "true");

        // c confirms the selected item; the remaining count and live region update.
        await page.keyboard.press("c");
        await expect(remaining(page)).toHaveText(new RegExp(`^${total - 1} item`));
        await expect(page.getByTestId("review-announce")).toHaveText(`${total - 1} items left`);

        // r rejects the (new) selected item.
        await page.keyboard.press("r");
        await expect(remaining(page)).toHaveText(new RegExp(`^${total - 2} item`));
        await expect(page.getByTestId("nav-count-review")).toHaveText(new RegExp(`^${total - 2}`));

        // The confirmed event now sits on the timeline; the timeline no longer shows a review block itself.
        await page.goto(`/app/cases/${caseId}/timeline`);
        await expect(page.getByText(/waiting for you to check/)).toBeVisible();
        await expect(page.getByRole("link", { name: /^Review/ }).first()).toBeVisible();
        await expect(page.locator("body")).not.toContainText(/confidence/);

        if (testInfo.project.name === "phone") {
            await page.goto(`/app/cases/${caseId}/review`);
            const first = items.first();
            await expect(first).toHaveAttribute("aria-selected", "true");
            // On a phone the passage is stacked inside the selected item, below its title.
            const inline = first.locator('[data-testid="excerpt"]');
            await expect(inline).toBeVisible();
            const titleBox = await first.locator("p.font-medium").first().boundingBox();
            const excerptBox = await inline.boundingBox();
            expect(titleBox && excerptBox && excerptBox.y > titleBox.y).toBeTruthy();
            // Nothing overflows horizontally.
            const overflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
            expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
            // Buttons still work by touch.
            await first.getByRole("button", { name: /^Confirm$|Record as the employer/ }).tap();
            await expect(remaining(page)).toHaveText(new RegExp(`^${total - 3} item`));
        }
    });

    test("allegations are recorded as the employer's, not agreed with; finishing the queue shows where things went", async ({ page }) => {
        await signUp(page);
        const caseId = await seedCase(page);
        await page.goto(`/app/cases/${caseId}/review`);
        const total = await readRemaining(page);

        // Work through everything with the mouse: confirm events, record allegations.
        for (let i = 0; i < total; i++) {
            const selected = page.locator('[data-testid="review-item"][aria-selected="true"]');
            await expect(selected).toBeVisible();
            const record = selected.getByRole("button", { name: /Record as the employer's allegation/ });
            if (await record.count()) {
                await expect(selected.getByText(/does not mean you agree/)).toBeVisible();
                await record.click();
            } else {
                await selected.getByRole("button", { name: "Confirm", exact: true }).click();
            }
            await expect(remaining(page)).toHaveText(i + 1 === total ? /Nothing left/ : new RegExp(`^${total - i - 1} item`), { timeout: 15_000 });
        }
        await expect(page.getByText("All reviewed")).toBeVisible();
        await expect(page.getByRole("link", { name: "Go to the timeline" })).toBeVisible();
        await expect(page.getByRole("link", { name: "Go to My case" })).toBeVisible();
        await expect(page.getByTestId("nav-count-review")).toHaveCount(0);

        // The recorded allegations are open on the disciplinary process with employer provenance.
        const procs = await page.request.get(`/api/cases/${caseId}/processes?type=disciplinary`);
        const { processes } = (await procs.json()) as { processes: Array<{ id: string }> };
        const res = await page.request.get(`/api/cases/${caseId}/processes/${processes[0].id}/allegations`);
        const { allegations } = (await res.json()) as { allegations: Array<{ status: string; provenance: string }> };
        expect(allegations.length).toBeGreaterThan(0);
        expect(allegations.every((a) => a.status === "open" && a.provenance === "EMPLOYER_ALLEGATION")).toBe(true);
    });
});
