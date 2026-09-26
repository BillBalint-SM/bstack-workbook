# Third-party notices

BontaFlowStack includes modified material from [garrytan/gstack](https://github.com/garrytan/gstack), which is MIT licensed. The files below also contain material derived from Apache-2.0 works. The Apache-2.0 license text is in `Apache-2.0.txt`.

## impeccable: Copyright Paul Bakaus, Apache License 2.0

Source: https://github.com/pbakaus/impeccable

Modified material in this package:

- `runtime/lib/design-catalog.ts` uses rule IDs and names from impeccable's `crates/live/assets/antipatterns.json`. Its prose was adapted through the gstack source.
- `runtime/bin/bfstack-design-detect.ts` and `runtime/lib/design-detect-contract.ts` integrate with an impeccable engine installed by the user.
- `skills/design-consultation/SKILL.md` includes rewritten design guidance from impeccable's `SKILL.md`, `reference/craft-floor.md`, and `reference/new-work.md`.

The upstream derivation also used `scripts/resolvers/design.ts`, `design-consultation/sections/proposal-and-preview.md.tmpl`, and `test/fixtures/impeccable-antipatterns.json`. Those are historical upstream paths, not files in the maintained BontaFlowStack package. The fixture was based on impeccable's `crates/live/assets/antipatterns.json` at commit `87d8f6d6` (`engine-v0.1.3`).

BontaFlowStack does not ship or mirror the impeccable engine, and its detector wrapper does not run impeccable's installer or launcher. After the user accepts a design skill's one-time offer, the wrapper can download the engine binary from impeccable's GitHub release into `~/.impeccable/bin/<version>/`. It checks the binary against the checksum in `runtime/lib/design-detect-contract.ts` and records the egress first. BontaFlowStack does not audit the engine's network behavior; the wrapper refuses URL targets.

## DESIGN.md specification: Copyright Google LLC, Apache License 2.0

Source: https://github.com/google-labs-code/design.md

`runtime/lib/design-md.ts` and `runtime/bin/bfstack-design-md.ts` implement the format: YAML token front matter in five groups, eight canonical sections in specification order, and `{path}` token references. The design consultation skill uses the same format. No specification text is reproduced.

## Session persistence attribution

`runtime/browse/src/session-persist.ts` contains portions copyright (c) 2026 Sina Matian, time-attack/gstack (GStack 2), MIT.
