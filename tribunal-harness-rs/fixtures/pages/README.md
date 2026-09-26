# Rendered page fixtures (TypeScript app)

Captured from the production Next.js build served locally:

```bash
cd tribunal-harness
# next/font/google fetches font CSS at build time; the sandbox proxy returns it in a
# form the loader rejects, so the documented test hook was used instead: a mock file
# mapping each Google Fonts CSS URL to the CSS text fetched with curl through the proxy.
NEXT_FONT_GOOGLE_MOCKED_RESPONSES=/path/to/font-mock.js npx next build
npx next start -p 3999
for r in / /adversarial-debate ... /docs /sitemap.xml /robots.txt /this-does-not-exist; do
  curl -s -o pages/<name>.html -w "%{http_code}" http://127.0.0.1:3999$r
done
```

Status codes observed: all 19 pages 200; `/analysis`, `/case-law`, `/docs` 307
(redirect bodies saved as `analysis.html`, `case-law.html`, `docs.html`);
`/this-does-not-exist` 404 (Next's default not-found page).

These HTML files are React server output and are **not** expected to match the
Rust (maud) markup byte-for-byte. The Rust UI tests use them as the source for
the user-visible strings that must be present on each page (titles, headings,
the LSA 2007 disclaimer sentence, consent wording, theme class), see
`crates/th-server/tests/pages.rs`.

Note: the mocked font hook makes `next/font` emit placeholder font files, so the
`@font-face` blocks in these captures reference tiny stub files; nothing else in
the markup is affected.
