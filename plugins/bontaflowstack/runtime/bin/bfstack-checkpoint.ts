#!/usr/bin/env bun
/** Project- and task-bound, read-only working-context checkpoints. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, parse as parsePath, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { atomicWriteSync } from "../lib/fs-atomic";

type SaveInput = { title?: unknown; status?: unknown; summary?: unknown; remaining_work?: unknown; files_modified?: unknown };
type Checkpoint = {
  id: string; project_key: string; task_id: string; branch: string; head: string; remote: string;
  worktree_hash: string; timestamp: string; title: string; status: string; integrity: string;
  summary: string; remaining_work: string[]; files_modified: string[];
};

const HOME = process.env.BFSTACK_HOME;
const SLUG = process.env.BFSTACK_PROJECT_SLUG;
const TASK = process.env.CODEX_THREAD_ID;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const fail = (message: string): never => { process.stderr.write(`bfstack-checkpoint: ${message}\n`); process.exit(1); };
const clean = (value: unknown, field: string, max = 4000) => {
  if (typeof value !== "string") fail(`${field} must be a string`);
  const text = value.replace(/[\r\n]+/g, " ").trim();
  if (!text || text.length > max) fail(`invalid ${field}`);
  return text;
};
const lines = (value: unknown, field: string) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 200) fail(`${field} must be an array`);
  return value.map((entry) => clean(entry, field, 1000));
};

function rejectReparse(path: string) {
  const absolute = resolve(path);
  const root = parsePath(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(/[\\/]+/).filter(Boolean)) {
    current = join(current, part);
    const entry = lstatSync(current, { throwIfNoEntry: false });
    if (entry?.isSymbolicLink()) fail("checkpoint state path contains a reparse point");
  }
}

function taskId() {
  if (typeof TASK !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(TASK)) fail("actual Codex task ID required");
  return TASK;
}
function git(args: string[]) {
  const result = spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8", windowsHide: true, shell: false });
  return result.status === 0 ? result.stdout.trim() : "";
}
function context() {
  if (!HOME || !isAbsolute(HOME)) fail("absolute BFSTACK_HOME required");
  if (!SLUG || !/^[A-Za-z0-9._-]{1,128}$/.test(SLUG)) fail("valid project slug required");
  const root = git(["rev-parse", "--show-toplevel"]);
  if (!root) fail("Git project required");
  const canonicalRoot = realpathSync(resolve(root));
  const branch = git(["branch", "--show-current"]);
  const head = git(["rev-parse", "HEAD"]);
  if (!branch || !head) fail("current Git branch and HEAD required");
  return {
    root: canonicalRoot,
    project_key: hash(canonicalRoot.toLowerCase()),
    branch, head,
    remote: git(["remote", "get-url", "origin"]),
    worktree_hash: hash(git(["status", "--porcelain=v1"])),
    directory: join(HOME, "projects", SLUG, "checkpoints"),
  };
}
function render(record: Omit<Checkpoint, "integrity">) {
  const unsigned = [
    "---", "schema: bfstack-checkpoint/v1", `id: ${record.id}`, `project_key: ${record.project_key}`,
    `task_id: ${record.task_id}`, `branch: ${record.branch}`, `head: ${record.head}`,
    `remote: ${Buffer.from(record.remote).toString("base64")}`, `worktree_hash: ${record.worktree_hash}`,
    `timestamp: ${record.timestamp}`, `title: ${Buffer.from(record.title).toString("base64")}`,
    `status: ${record.status}`, "integrity: __HASH__", `files_modified: ${Buffer.from(JSON.stringify(record.files_modified)).toString("base64")}`,
    "---", "", "## Summary", record.summary, "", "## Remaining Work", ...record.remaining_work.map((item) => `- ${item}`), "",
  ].join("\n");
  return unsigned.replace("__HASH__", hash(unsigned));
}
function parse(path: string): Checkpoint {
  rejectReparse(path);
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch { fail("checkpoint is unreadable"); }
  const match = text.match(/^---\n([\s\S]*?)\n---\n\n## Summary\n([^\n]+)\n\n## Remaining Work\n([\s\S]*)$/);
  if (!match) fail("checkpoint is corrupt");
  const fields = Object.fromEntries(match[1].split("\n").map((line) => {
    const i = line.indexOf(": "); return i > 0 ? [line.slice(0, i), line.slice(i + 2)] : ["", ""];
  }));
  if (fields.schema !== "bfstack-checkpoint/v1" || !/^[0-9a-f-]{36}$/.test(fields.id || "") || !/^[0-9a-f]{64}$/.test(fields.integrity || "")) fail("checkpoint metadata is invalid");
  const unsigned = text.replace(`integrity: ${fields.integrity}`, "integrity: __HASH__");
  if (hash(unsigned) !== fields.integrity) fail("checkpoint integrity check failed");
  let title: string, remote: string, files_modified: string[];
  try {
    title = Buffer.from(fields.title, "base64").toString("utf8");
    remote = Buffer.from(fields.remote, "base64").toString("utf8");
    files_modified = JSON.parse(Buffer.from(fields.files_modified, "base64").toString("utf8"));
  } catch { fail("checkpoint metadata is invalid"); }
  if (!Array.isArray(files_modified) || !fields.task_id || !fields.branch || !fields.head || !fields.project_key || !fields.worktree_hash || !fields.timestamp || !fields.status) fail("checkpoint metadata is invalid");
  const remaining_work = match[3].trim() ? match[3].trim().split("\n").map((line) => line.replace(/^- /, "").trim()) : [];
  return { id: fields.id, project_key: fields.project_key, task_id: fields.task_id, branch: fields.branch, head: fields.head, remote, worktree_hash: fields.worktree_hash, timestamp: fields.timestamp, title, status: fields.status, integrity: fields.integrity, summary: match[2], remaining_work, files_modified };
}
function checkpointPath(directory: string, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) fail("valid checkpoint ID required");
  const path = join(directory, `${id}.md`);
  rejectReparse(path);
  if (relative(directory, path).startsWith("..") || !existsSync(path)) fail("checkpoint not found");
  return path;
}

const [command, id] = process.argv.slice(2);
if (command === "save") {
  let input: SaveInput;
  try { input = JSON.parse(readFileSync(0, "utf8")); } catch { fail("valid JSON input required"); }
  const current = context();
  const record = {
    id: randomUUID(), project_key: current.project_key, task_id: taskId(), branch: current.branch, head: current.head,
    remote: current.remote, worktree_hash: current.worktree_hash, timestamp: new Date().toISOString(),
    title: clean(input.title ?? "untitled", "title", 120), status: clean(input.status ?? "in-progress", "status", 80),
    summary: clean(input.summary ?? "No summary recorded.", "summary"), remaining_work: lines(input.remaining_work, "remaining_work"), files_modified: lines(input.files_modified, "files_modified"),
  };
  rejectReparse(current.directory);
  mkdirSync(current.directory, { recursive: true });
  rejectReparse(current.directory);
  const path = join(current.directory, `${record.id}.md`);
  rejectReparse(path);
  atomicWriteSync(path, render(record), { mode: 0o600 });
  parse(path);
  process.stdout.write(JSON.stringify({ id: record.id, path }) + "\n");
} else if (command === "restore") {
  const current = context();
  const record = parse(checkpointPath(current.directory, id || ""));
  if (record.project_key !== current.project_key) fail("checkpoint belongs to another project");
  const fresh = { requires_fresh_authorization: true };
  if (record.task_id !== taskId()) {
    process.stdout.write(JSON.stringify({ mode: "summary", title: record.title, status: record.status, summary: record.summary, remaining_work: record.remaining_work, ...fresh }) + "\n");
  } else {
    if (record.branch !== current.branch || record.head !== current.head || record.remote !== current.remote || record.worktree_hash !== current.worktree_hash) fail("checkpoint target or Git state changed; fresh review required");
    process.stdout.write(JSON.stringify({ mode: "continue", title: record.title, status: record.status, summary: record.summary, remaining_work: record.remaining_work, ...fresh }) + "\n");
  }
} else if (command === "list") {
  const current = context();
  rejectReparse(current.directory);
  if (!existsSync(current.directory)) { process.stdout.write("[]\n"); process.exit(0); }
  const records = readdirSync(current.directory)
    .filter((name) => /^[0-9a-f-]{36}\.md$/.test(name))
    .map((name) => parse(join(current.directory, name)));
  if (records.some((record) => record.project_key !== current.project_key)) fail("checkpoint belongs to another project");
  records.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  process.stdout.write(JSON.stringify(records.map(({ id: checkpoint_id, title, status, branch, timestamp }) => ({ checkpoint_id, title, status, branch, timestamp }))) + "\n");
} else {
  fail("usage: bfstack-checkpoint save | list | restore <checkpoint-id>");
}
