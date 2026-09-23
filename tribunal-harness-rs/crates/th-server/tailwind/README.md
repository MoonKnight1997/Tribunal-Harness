# Stylesheet build

`input.css` is the Next.js app's `src/app/globals.css` **verbatim** (Tailwind v4,
`@import "tailwindcss"` + the `@theme` block), preceded by an `@source "../src"`
line so the class names in the maud templates and inline scripts are picked up,
and followed by `ui-port.css` (state classes the inline scripts toggle).

The compiled stylesheet is committed as `../static/app.css` and embedded into the
binary with `include_str!`, so **no Node or Tailwind is needed at runtime**.

Rebuild after changing any template class or the CSS:

```bash
# Tailwind standalone CLI v4 (no Node): https://github.com/tailwindlabs/tailwindcss/releases
tailwindcss --input crates/th-server/tailwind/input.css --output crates/th-server/static/app.css --minify
```
