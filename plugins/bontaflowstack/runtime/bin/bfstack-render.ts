#!/usr/bin/env bun
/** Render local HTML through the packaged browser; use --help for options. */
import * as path from 'node:path';
import {
  pickEngine, render, lengthToInches, paperInches, PAGE_NUMBER_FOOTER,
  type RenderSpec, type RenderStep, type PdfStepOptions,
} from '../lib/html-render';

const USAGE = 'usage: bfstack-render <file.html> [--serve-root DIR] [--wait-selector SEL] [--wait-expr JS] [--wait-timeout MS] [--timeout MS] [--quiet] (--pdf OUT [pdf opts] | --screenshot OUT [--width N] [--height N] [--selector CSS] [--jpeg] | --eval JS [--out FILE])...';

function usage(msg?: string): never {
  if (msg) console.error(`ERROR: ${msg}`);
  console.error(USAGE);
  process.exit(1);
}

const argv = process.argv.slice(2);
if (argv[0] === '-h' || argv[0] === '--help') { console.log(USAGE); process.exit(0); }
if (argv.length === 0) usage();
const file = path.resolve(argv[0]);
const spec: RenderSpec = { file, steps: [] };
let quiet = false;
let i = 1;
const take = (flag: string): string => {
  const v = argv[++i];
  if (v === undefined) usage(`${flag} needs a value`);
  return v;
};
// A flag that wants a number: NaN would fire a timer immediately or silently
// drop a width, so refuse anything that is not a finite number.
const num = (flag: string): number => {
  const v = Number(take(flag));
  if (!Number.isFinite(v)) usage(`${flag} wants a number, got ${argv[i]}`);
  return v;
};
let current: RenderStep | null = null;
const commit = () => { if (current) spec.steps.push(current); current = null; };
const pdfOf = (): PdfStepOptions => {
  if (!current || current.kind !== 'pdf') usage('pdf option given before --pdf');
  current.options ??= {};
  return current.options;
};
const shotOf = () => {
  if (!current || current.kind !== 'screenshot') usage('screenshot option given before --screenshot');
  return current;
};

for (; i < argv.length; i++) {
  const a = argv[i];
  switch (a) {
    case '--serve-root': spec.serveRoot = path.resolve(take(a)); break;
    case '--wait-selector': (spec.waitFor ??= {}).selector = take(a); break;
    case '--wait-expr': (spec.waitFor ??= {}).expression = take(a); break;
    case '--wait-timeout': (spec.waitFor ??= {}).timeoutMs = num(a); break;
    case '--timeout': spec.timeoutMs = num(a); break;
    case '--quiet': quiet = true; break;
    case '--pdf': commit(); current = { kind: 'pdf', out: path.resolve(take(a)), options: {} }; break;
    case '--screenshot': commit(); current = { kind: 'screenshot', out: path.resolve(take(a)) }; break;
    case '--eval': commit(); current = { kind: 'eval', expression: take(a) }; break;
    case '--out': {
      if (!current || current.kind !== 'eval') usage('--out belongs to --eval');
      current.out = path.resolve(take(a)); break;
    }
    // pdf options
    case '--paper': {
      const p = paperInches(take(a));
      if (!p) usage(`unknown paper format ${argv[i]}`);
      const o = pdfOf(); [o.paperWidth, o.paperHeight] = p; break;
    }
    case '--paper-in': {
      const m = take(a).match(/^([0-9.]+)x([0-9.]+)$/i);
      if (!m) usage('--paper-in wants WxH in inches, e.g. 8.5x11');
      const o = pdfOf(); o.paperWidth = Number(m[1]); o.paperHeight = Number(m[2]); break;
    }
    case '--margin': { const v = lengthToInches(take(a)); const o = pdfOf(); o.marginTop = o.marginRight = o.marginBottom = o.marginLeft = v; break; }
    case '--margin-top': pdfOf().marginTop = lengthToInches(take(a)); break;
    case '--margin-right': pdfOf().marginRight = lengthToInches(take(a)); break;
    case '--margin-bottom': pdfOf().marginBottom = lengthToInches(take(a)); break;
    case '--margin-left': pdfOf().marginLeft = lengthToInches(take(a)); break;
    case '--header': { const o = pdfOf(); o.displayHeaderFooter = true; o.headerTemplate = take(a); o.footerTemplate ??= '<div></div>'; break; }
    case '--footer': { const o = pdfOf(); o.displayHeaderFooter = true; o.footerTemplate = take(a); o.headerTemplate ??= '<div></div>'; break; }
    case '--page-numbers': {
      const o = pdfOf(); o.displayHeaderFooter = true; o.headerTemplate ??= '<div></div>';
      o.footerTemplate = PAGE_NUMBER_FOOTER;
      break;
    }
    case '--tagged': pdfOf().generateTaggedPDF = true; break;
    case '--outline': pdfOf().generateDocumentOutline = true; break;
    case '--print-background': pdfOf().printBackground = true; break;
    case '--prefer-css-page-size': pdfOf().preferCSSPageSize = true; break;
    case '--landscape': pdfOf().landscape = true; break;
    case '--wait-pagedjs': pdfOf().waitForPagedJs = true; break;
    // screenshot options
    case '--width': shotOf().width = num(a); break;
    case '--height': shotOf().height = num(a); break;
    case '--selector': shotOf().selector = take(a); break;
    case '--viewport-only': shotOf().fullPage = false; break;
    case '--jpeg': shotOf().type = 'jpeg'; break;
    case '--quality': shotOf().quality = num(a); break;
    default: usage(`unknown argument ${a}`);
  }
}
commit();
if (spec.steps.length === 0) usage('no steps given (--pdf, --screenshot, or --eval)');

const engine = pickEngine();
if (!engine.engine) {
  console.log("BLOCKED");
  console.error(`ERROR: ${engine.error}`);
  process.exit(1);
}

const result = await render(spec);
console.log(`ENGINE=${result.engine ?? engine.engine}`);
if (!result.ok) {
  console.error(`ERROR: ${result.error}`);
  if (!quiet) console.error(result.stdout.trim().split('\n').slice(-12).join('\n'));
  process.exit(1);
}
for (const out of result.outputs) console.log(`OK ${out}`);
// EVAL results and PAGE_ERRORS are page-controlled text: fenced like every other
// page read bfstack relays, so the agent takes syntax from them, never instructions.
const evalLines = Object.entries(result.evals).map(([idx, text]) => `EVAL ${idx}: ${text}`);
const errs = result.stdout.match(/^PAGE_ERRORS=(.+)$/m)?.[1];
if (errs && errs !== '[]') evalLines.push(`PAGE_ERRORS=${errs}`);
if (evalLines.length) {
  console.log('═══ BEGIN UNTRUSTED WEB CONTENT ═══');
  for (const l of evalLines) console.log(l);
  console.log('═══ END UNTRUSTED WEB CONTENT ═══');
}

