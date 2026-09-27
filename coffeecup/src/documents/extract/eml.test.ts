import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEmlBuffer, parseEml, decodeEncodedWords, decodeQuotedPrintable, htmlToText, parseContentType, splitMultipart } from "./eml";

const FIXTURES = path.join(__dirname, "fixtures");
const load = (name: string) => readFileSync(path.join(FIXTURES, name));

describe("eml primitives", () => {
    it("decodes RFC 2047 encoded-words (B and Q, adjacent words joined)", () => {
        expect(decodeEncodedWords("=?utf-8?B?SGVsbG8gd29ybGQ=?=")).toBe("Hello world");
        expect(decodeEncodedWords("=?iso-8859-1?Q?Jos=E9_Garc=EDa?= <j@x>")).toBe("José García <j@x>");
        expect(decodeEncodedWords("=?utf-8?B?SGVs?= =?utf-8?B?bG8=?=")).toBe("Hello");
        expect(decodeEncodedWords("plain subject")).toBe("plain subject");
    });
    it("decodes quoted-printable including soft line breaks", () => {
        const bytes = decodeQuotedPrintable("caf=C3=A9 on=\r\n line");
        expect(new TextDecoder().decode(bytes)).toBe("café on line");
    });
    it("strips HTML to text keeping paragraph breaks and decoding entities", () => {
        const t = htmlToText("<style>p{}</style><p>One &amp; two</p><p>Three<br>four &ldquo;q&rdquo; &#163;5</p>");
        expect(t).toBe("One & two\n\nThree\nfour “q” £5");
    });
    it("parses content-type parameters, quoted and RFC 2231", () => {
        const ct = parseContentType('multipart/mixed; boundary="abc def"; charset=utf-8');
        expect(ct.mime).toBe("multipart/mixed");
        expect(ct.params.boundary).toBe("abc def");
        expect(parseContentType("application/pdf; name*=utf-8''pay%20slip.pdf").params.name).toBe("pay slip.pdf");
    });
    it("splits multipart bodies on the boundary, ignoring the preamble and epilogue", () => {
        const parts = splitMultipart("preamble\r\n--b\r\nA: 1\r\n\r\nfirst\r\n--b\r\nA: 2\r\n\r\nsecond\r\n--b--\r\nepilogue", "b");
        expect(parts).toHaveLength(2);
        expect(parts[0]).toContain("first");
        expect(parts[1]).toContain("second");
    });
});

describe("eml fixtures", () => {
    it("01 CRLF plain: the body survives (F10 reproduction)", () => {
        const r = parseEmlBuffer(load("01-crlf-plain.eml"));
        expect(r.status).toBe("completed");
        expect(r.headers.subject).toBe("Disciplinary hearing");
        expect(r.headers.from).toContain("hr@acme.example");
        expect(r.text).toMatch(/^From: HR Department/);
        expect(r.text).toContain("disciplinary hearing on 3 March 2026 at 10am");
        expect(r.attachments).toEqual([]);
        expect(r.parts).toEqual([{ kind: "body", contentType: "text/plain", read: true }]);
    });

    it("02 LF plain", () => {
        const r = parseEmlBuffer(load("02-lf-plain.eml"));
        expect(r.status).toBe("completed");
        expect(r.text).toContain("suspended on 20 January 2026");
        expect(r.headers.date).toBe("20 Jan 2026 17:02:00 +0000");
    });

    it("03 folded headers and encoded-word subject/from", () => {
        const r = parseEmlBuffer(load("03-folded-encoded-subject.eml"));
        expect(r.status).toBe("completed");
        expect(r.headers.from).toBe("José García <jose@acme.example>");
        expect(r.headers.to).toBe("worker@example.com, second@example.com, third@example.com");
        expect(r.headers.subject).toBe("Grievance outcome – £250 deduction – final");
        expect(r.text).toContain("£250 on 31 January 2026");
    });

    it("04 multipart/alternative: text/plain preferred, quoted-printable decoded, html alternative not double-counted", () => {
        const r = parseEmlBuffer(load("04-alternative-qp.eml"));
        expect(r.status).toBe("completed");
        expect(r.text).toContain("We’re writing to confirm the investigation meeting on 12 February 2026 at 2pm. Please bring your notes — thank you.");
        expect(r.text.match(/investigation meeting/g)).toHaveLength(1);
        expect(r.parts.map((p) => [p.contentType, p.read])).toEqual([["multipart/alternative", true], ["text/plain", true], ["text/html", false]]);
    });

    it("05 base64 utf-8 body", () => {
        const r = parseEmlBuffer(load("05-base64-utf8.eml"));
        expect(r.status).toBe("completed");
        expect(r.text).toContain("Hello Zoë,");
        expect(r.text).toContain("£1,234.56 was processed on 27 February 2026. Naïve café résumé.");
    });

    it("06 multipart/mixed with a PDF attachment: body read, attachment inventoried not extracted", () => {
        const r = parseEmlBuffer(load("06-mixed-pdf-attachment.eml"));
        expect(r.status).toBe("completed");
        expect(r.text).toContain("Net pay was paid on 28 February 2026");
        expect(r.text).not.toContain("%PDF");
        expect(r.attachments).toEqual([{ filename: "payslip.pdf", contentType: "application/pdf", sizeBytes: expect.any(Number) }]);
        expect(r.attachments[0].sizeBytes).toBeGreaterThan(10);
        expect(r.note).toMatch(/1 attachment not read: payslip.pdf/);
        expect(r.parts.find((p) => p.kind === "attachment")?.read).toBe(false);
    });

    it("07 HTML-only: stripped to text with paragraph breaks, scripts/styles removed, entities decoded", () => {
        const r = parseEmlBuffer(load("07-html-only.eml"));
        expect(r.status).toBe("completed");
        expect(r.text).toContain("Notes of the meeting on 5 March 2026.");
        expect(r.text).toContain("You said you were “unhappy” with the rota & the pay.\nWe agreed to review it.");
        expect(r.text).toContain("- Action: HR to respond by 12 March 2026\n- Action: manager to share the rota");
        expect(r.text).not.toMatch(/alert|color: red|<p>/);
        expect(r.parts.map((p) => p.read)).toEqual([true]);
    });

    it("08 nested forwarded message/rfc822 included as text with its own headers", () => {
        const r = parseEmlBuffer(load("08-nested-forwarded.eml"));
        expect(r.status).toBe("completed");
        expect(r.text).toContain("Thought you should see this.");
        expect(r.text).toContain("---- Forwarded message ----");
        expect(r.text).toContain("From: director@acme.example");
        expect(r.text).toContain("Suspend her tomorrow, 20 January 2026.");
        expect(r.text.match(/Suspend her tomorrow/g)).toHaveLength(1); // inner html alternative not duplicated
        expect(r.parts.some((p) => p.kind === "forwarded" && p.read)).toBe(true);
        expect(r.attachments).toEqual([]);
    });

    it("09 unsupported transfer encoding on the only body part → partial, never a successful empty read", () => {
        const r = parseEmlBuffer(load("09-unsupported-encoding.eml"));
        expect(r.status).toBe("partial");
        expect(r.note).toMatch(/could not be read/);
        expect(r.note).toMatch(/x-uuencode/);
        expect(r.text).toMatch(/^From: hr@acme.example/); // headers kept
        expect(r.text).not.toContain("begin 644");
        expect(r.parts).toEqual([{ kind: "body", contentType: "text/plain", read: false, note: expect.stringContaining("x-uuencode") }]);
    });

    it("10 windows-1252 8bit body decodes curly quotes and the euro sign", () => {
        const r = parseEmlBuffer(load("10-windows-1252.eml"));
        expect(r.status).toBe("completed");
        expect(r.text).toContain("“final written warning” on 4 March 2026. Expenses of €40 were refused.");
    });

    it("non-email bytes → failed, not an empty success", () => {
        const r = parseEmlBuffer(Buffer.from("\u0000\u0001binary junk without headers"));
        expect(r.status).toBe("failed");
    });

    it("parseEml (string) keeps the legacy contract", () => {
        const text = parseEml("From: hr@acme.example\nTo: worker@example.com\nSubject: Hearing\nDate: 1 Mar 2026\n\nPlease attend on 3 March 2026.");
        expect(text).toMatch(/^From: hr@acme.example/);
        expect(text).toMatch(/Please attend/);
    });
});
