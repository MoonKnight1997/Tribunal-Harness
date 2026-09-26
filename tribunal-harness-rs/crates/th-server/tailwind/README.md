# Stylesheet build

`input.css` is the Next.js app's `src/app/globals.css` **verbatim** (Tailwind v4,
`@import "tailwindcss"` + the `@theme` block), preceded by an `@source "../src"`
line so the class names in the maud templates and inline scripts are picked up,
and followed by `ui-port.css` (state classes the inline scripts toggle).

The only change to the import line is `source(none)`: Tailwind v4 otherwise
also scans the working directory automatically, which would make the output
depend on where the CLI is run from (CI runs it from `tribunal-harness-rs/`,
which also contains the captured Next.js page fixtures). With `source(none)`
only the explicit `@source` is scanned and the build is byte-identical from any
directory.

The compiled stylesheet is committed as `../static/app.css` and embedded into the
binary with `include_str!`, so **no Node or Tailwind is needed at runtime**.
The Rust CI workflow rebuilds it with the pinned CLI and fails if the committed
file differs ("Check committed stylesheet is current").

Rebuild after changing any template class or the CSS:

```bash
# Tailwind standalone CLI v4.3.3 (no Node): https://github.com/tailwindlabs/tailwindcss/releases
tailwindcss --input crates/th-server/tailwind/input.css --output crates/th-server/static/app.css --minify
```
