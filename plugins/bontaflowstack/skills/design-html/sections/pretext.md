# Packaged Pretext

Read the bundle at `$BFSTACK_ROOT/design-html/vendor/pretext.js` when using
advanced APIs. This reference describes that bundle, not a remote version.
It exposes `window.Pretext`; wait for fonts before preparing text. Use a
numeric line height and the same font as the rendered element.

- Simple/card layout: `prepare(text, font)`, then
  `layout(handle, width, lineHeight)` → `{height, lineCount}`.
- Chat/shrinkwrap: prepare once, search a positive width range using
  `layout` and the target line count. Avoid repeatedly preparing unchanged text.
- Editorial: `prepareWithSegments(text, font)`, then
  `layoutNextLine(handle, {segmentIndex: 0, graphemeIndex: 0}, width)`.
  A line has `text`, `width`, `start`, `end`; continue with the previous
  `end` cursor and a positive available width. Stop on null. Do not pass null
  as the initial cursor or read a nonexistent `state` field.
- Manual rendering: `layoutWithLines(handle, width, lineHeight)` returns
  `{height, lineCount, lines}`. Each line has text/width/start/end, not x/y.
  Position lines using the chosen line height and layout offsets.
- `walkLineRanges(handle, width, callback)` calls back with a single range
  object (`width`, `start`, `end`); it does not enumerate narrower widths.
- `clearCache()` resets measurements; `setLocale(locale)` resets segmentation.

For an ordinary card, after the inline bundle:
```js
await document.fonts.ready;
const el = document.querySelector('[data-pretext]');
const font = getComputedStyle(el).font;
let prepared = Pretext.prepare(el.textContent, font);
function relayout() {
  const width = el.clientWidth;
  if (width <= 0) return;
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
  if (!Number.isFinite(lineHeight)) throw new Error('Explicit line-height required');
  el.style.minHeight = Pretext.layout(prepared, width, lineHeight).height + 'px';
}
new ResizeObserver(relayout).observe(el);
relayout();
```

Re-prepare after font or text changes; add MutationObserver only for editable
content. Disconnect observers on framework unmount. Render and exercise the
chosen API with real text before claiming it works.
