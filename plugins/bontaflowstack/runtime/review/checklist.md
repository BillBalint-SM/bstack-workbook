# Pre-landing review checklist

Read the explicitly selected local diff or file pair and affected callers.
Severity follows consequence and confidence, not category alone. Apply relevant
specialist references in this task; they do not automatically spawn agents.
Return location, trigger, consequence, evidence and a minimal recommendation.
Review is read-only unless the user authorized repairs. Do not auto-fix based on
line count, a pattern match or a label. No findings means only the checked scope.
## Review Categories

### Pass 1 — CRITICAL

#### SQL & Data Safety
- String interpolation in SQL (even if values are `.to_i`/`.to_f` — use parameterized queries (Rails: sanitize_sql_array/Arel; Node: prepared statements; Python: parameterized queries))
- TOCTOU races: check-then-set patterns that should be atomic `WHERE` + `update_all`
- Bypassing model validations for direct DB writes (Rails: update_column; Django: QuerySet.update(); Prisma: raw queries)
- N+1 queries: Missing eager loading (Rails: .includes(); SQLAlchemy: joinedload(); Prisma: include) for associations used in loops/views

#### Race Conditions & Concurrency
- Read-check-write without uniqueness constraint or catch duplicate key error and retry (e.g., `where(hash:).first` then `save!` without handling concurrent insert)
- find-or-create without unique DB index — concurrent calls can create duplicates
- Status transitions that don't use atomic `WHERE old_status = ? UPDATE SET new_status` — concurrent updates can skip or double-apply transitions
- Unsafe HTML rendering (Rails: .html_safe/raw(); React: dangerouslySetInnerHTML; Vue: v-html; Django: |safe/mark_safe) on user-controlled data (XSS)

#### LLM Output Trust Boundary
- LLM-generated values (emails, URLs, names) written to DB or passed to mailers without format validation. Add lightweight guards (`EMAIL_REGEXP`, `URI.parse`, `.strip`) before persisting.
- Structured tool output (arrays, hashes) accepted without type/shape checks before database writes.
- LLM-generated URLs fetched without allowlist — SSRF risk if URL points to internal network (Python: `urllib.parse.urlparse` → check hostname against blocklist before `requests.get`/`httpx.get`)
- LLM output stored in knowledge bases or vector DBs without sanitization — stored prompt injection risk

#### Shell Injection (Python-specific)
- `subprocess.run()` / `subprocess.call()` / `subprocess.Popen()` with `shell=True` AND f-string/`.format()` interpolation in the command string — use argument arrays instead
- `os.system()` with variable interpolation — replace with `subprocess.run()` using argument arrays
- `eval()` / `exec()` on LLM-generated code without sandboxing

#### Enum & Value Completeness
When the diff introduces a new enum value, status string, tier name, or type constant:
- **Trace it through every consumer.** Read (don't just grep — READ) each file that switches on, filters by, or displays that value. If any consumer doesn't handle the new value, flag it. Common miss: adding a value to the frontend dropdown but the backend model/compute method doesn't persist it.
- **Check allowlists/filter arrays.** Search for arrays or `%w[]` lists containing sibling values (e.g., if adding "revise" to tiers, find every `%w[quick lfg mega]` and verify "revise" is included where needed).
- **Check `case`/`if-elsif` chains.** If existing code branches on the enum, does the new value fall through to a wrong default?
To do this: use available text search to find all references to the sibling values (e.g., grep for "lfg" or "mega" to find all tier consumers). Read each match. This step requires reading code OUTSIDE the diff.

### Pass 2 — INFORMATIONAL

#### Async/Sync Mixing (Python-specific)
- Synchronous `subprocess.run()`, `open()`, `requests.get()` inside `async def` endpoints — blocks the event loop. Use `asyncio.to_thread()`, `aiofiles`, or `httpx.AsyncClient` instead.
- `time.sleep()` inside async functions — use `asyncio.sleep()`
- Sync DB calls in async context without `run_in_executor()` wrapping

#### Column/Field Name Safety
- Verify column names in ORM queries (`.select()`, `.eq()`, `.gte()`, `.order()`) against actual DB schema — wrong column names silently return empty results or throw swallowed errors
- Check `.get()` calls on query results use the column name that was actually selected
- Cross-reference with schema documentation when available

#### Dead Code & Consistency (version/changelog only — other items handled by maintainability specialist)
- Version mismatch between PR title and VERSION/CHANGELOG files
- CHANGELOG entries that describe changes inaccurately (e.g., "changed from X to Y" when X never existed)

#### LLM Prompt Issues
- Indexing conventions inconsistent with actual consumers
- Prompt text listing available tools/capabilities that don't match what's actually wired up in the `tool_classes`/`tools` array
- Word/token limits stated in multiple places that could drift

#### Completeness Gaps
- Compare promised behavior and acceptance criteria with the actual implementation.
- Flag missing branches or checks only when they expose a concrete in-scope defect.
- Do not expand features based on speculative effort estimates.

#### Time Window Safety
- Date-key lookups that assume "today" covers 24h — report at 8am PT only sees midnight→8am under today's key
- Mismatched time windows between related features — one uses hourly buckets, another uses daily keys for the same data

#### Type Coercion at Boundaries
- Values crossing Ruby→JSON→JS boundaries where type could change (numeric vs string) — hash/digest inputs must normalize types
- Hash/digest inputs that don't call `.to_s` or equivalent before serialization — `{ cores: 8 }` vs `{ cores: "8" }` produce different hashes

#### View/Frontend
- Inline `<style>` blocks in partials (re-parsed every render)
- O(n*m) lookups in views (`Array#find` in a loop instead of `index_by` hash)
- Ruby-side `.select{}` filtering on DB results that could be a `WHERE` clause (unless intentionally avoiding leading-wildcard `LIKE`)

#### Distribution & CI/CD Pipeline
- CI/CD workflow changes (`.github/workflows/`): verify build tool versions match project requirements, artifact names/paths are correct, secrets use `${{ secrets.X }}` not hardcoded values
- New artifact types (CLI binary, library, package): verify a publish/release workflow exists and targets correct platforms
- Cross-platform builds: verify CI matrix covers all target OS/arch combinations, or documents which are untested
- Version tag format consistency: `v1.2.3` vs `1.2.3` — must match across VERSION file, git tags, and publish scripts
- Publish step idempotency: retry safely without deleting existing releases or user data.

**DO NOT flag:**
- Web services with existing auto-deploy pipelines (Docker build + K8s deploy)
- Internal tools not distributed outside the team
- Test-only CI changes (adding test steps, not publish steps)

---

## Suppressions and decisions

Skip harmless redundancy, style-only preferences, unreachable hypothetical
inputs and issues already resolved in the complete diff. A documented shortcut
is not a waiver of a real defect: verify its decision and stated ceiling through
bontaflow-memory before using it as context. Missing ledger evidence stays
unverified. Do not edit the ledger as part of a read-only review.