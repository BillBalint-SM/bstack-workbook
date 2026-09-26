# Pretext vendor provenance

`pretext.js` is a generated, self-contained browser IIFE from the official
[`@chenglou/pretext` 0.0.8](https://github.com/chenglou/pretext) package. The
small `runtime/pretext-browser-entry.js` adapter retains the package's public
exports and assigns them to `globalThis.Pretext`. The exact package integrity
is recorded in `runtime/bun.lock`; its MIT notice is retained as
`PRETEXT.LICENSE`.

The build recipe is deliberately kept in
`scripts/build-adopted-renderers.ps1`:

```text
bun build runtime/pretext-browser-entry.js \
  --target=browser --format=iife \
  --outfile plugins/bontaflowstack/runtime/design-html/vendor/pretext.js
```

The standalone IIFE is required because design-html inlines this file in a
plain `<script>` element and reads `window.Pretext`, with no network request
or relative-module loader.

**Distribution status: VERIFIED** after the plain-script browser API check.
