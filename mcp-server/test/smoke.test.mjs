// End-to-end check: spawns the real server over stdio and drives every tool
// through an MCP client against a throwaway vault. Run with `npm test`.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "..", "dist", "index.js");

const vault = fs.mkdtempSync(path.join(os.tmpdir(), "vault-test-"));
for (const c of ["re", "general"]) {
  for (const d of ["patterns", "solved-problems", "tool-notes", "attachments"]) {
    fs.mkdirSync(path.join(vault, c, d), { recursive: true });
  }
}
const git = (...args) => execFileSync("git", args, { cwd: vault, encoding: "utf8" });
git("init", "-q");
git("config", "user.email", "test@example.com");
git("config", "user.name", "test");

const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: { ...process.env, KNOWLEDGE_VAULT_PATH: vault },
  })
);

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { text: r.content.map((c) => c.text).join("\n"), isError: !!r.isError };
};

test("all seven tools are exposed", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ["get_entry", "list_categories", "log_solved_problem", "read_index", "save_pattern", "save_tool_note", "search_knowledge"]
  );
});

test("save_pattern writes the file, indexes it, and commits", async () => {
  const r = await call("save_pattern", {
    category: "re",
    topic: "anti-debug",
    technique: "IsDebuggerPresent",
    details: "Reads PEB->BeingDebugged. Patch the return to 0.",
  });
  assert.equal(r.isError, false);

  const file = path.join(vault, "re", "patterns", "anti-debug.md");
  assert.match(fs.readFileSync(file, "utf8"), /## IsDebuggerPresent/);

  const index = fs.readFileSync(path.join(vault, "INDEX.md"), "utf8");
  assert.match(index, /re\/patterns\/anti-debug\.md — IsDebuggerPresent \(1 technique logged\)/);

  // Committed locally; no remote configured, so the push is reported as skipped.
  assert.match(r.text, /Push skipped: no git remote/);
  assert.match(git("log", "--oneline"), /Add pattern: anti-debug/);
});

test("a second technique appends and the index count follows", async () => {
  await call("save_pattern", {
    category: "re",
    topic: "anti-debug",
    technique: "RDTSC timing",
    details: "Compares elapsed cycles across a block.",
  });
  const index = fs.readFileSync(path.join(vault, "INDEX.md"), "utf8");
  assert.match(index, /IsDebuggerPresent, RDTSC timing \(2 techniques logged\)/);
});

test("a new category is created on the fly", async () => {
  await call("save_tool_note", { category: "streamersuite", tool: "OBS", note: "Websocket 5 auth needs the base64 salt." });
  assert.ok(fs.existsSync(path.join(vault, "streamersuite", "tool-notes", "obs.md")));

  const { text } = await call("list_categories");
  assert.deepEqual(text.split("\n").sort(), ["general", "re", "streamersuite"]);
  assert.match(fs.readFileSync(path.join(vault, "INDEX.md"), "utf8"), /## streamersuite/);
});

test("log_solved_problem writes a summary line and copies screenshots", async () => {
  const shot = path.join(vault, "shot.png");
  fs.writeFileSync(shot, "not really a png");

  const r = await call("log_solved_problem", {
    category: "re",
    name: "crackme01",
    summary: "Serial derived from a XOR of the username",
    technique: "Static analysis in Ghidra",
    fullNotes: "Found the check at 0x401230.",
    screenshotPaths: [shot],
  });
  assert.equal(r.isError, false);

  const note = fs.readFileSync(path.join(vault, "re", "solved-problems", "crackme01.md"), "utf8");
  assert.match(note, /!\[shot\.png\]\(\.\.\/attachments\/crackme01\/shot\.png\)/);
  assert.ok(fs.existsSync(path.join(vault, "re", "attachments", "crackme01", "shot.png")));
  assert.match(
    fs.readFileSync(path.join(vault, "INDEX.md"), "utf8"),
    /re\/solved-problems\/crackme01\.md — Serial derived from a XOR of the username/
  );
});

test("binaries are refused as attachments", async () => {
  const exe = path.join(vault, "crackme.exe");
  fs.writeFileSync(exe, "MZ");
  const r = await call("log_solved_problem", {
    category: "re",
    name: "crackme02",
    summary: "s",
    technique: "t",
    fullNotes: "n",
    screenshotPaths: [exe],
  });
  assert.equal(r.isError, true);
  assert.match(r.text, /only image files are allowed/);
});

test("empty input is rejected with a clear message", async () => {
  const r = await call("save_pattern", { category: "re", topic: "   ", technique: "x", details: "y" });
  assert.equal(r.isError, true);
  assert.match(r.text, /topic must not be empty/);
});

test("path traversal is refused", async () => {
  const r = await call("get_entry", { category: "../../etc", type: "pattern", name: "passwd" });
  assert.equal(r.isError, true);
});

test("unrelated work in the vault is not swept into the commit", async () => {
  const stray = path.join(vault, "general", "patterns", "wip-draft.md");
  fs.writeFileSync(stray, "half-written, not ready to commit");

  await call("save_tool_note", { category: "re", tool: "ghidra", note: "Ctrl+L retypes a variable." });

  assert.match(git("status", "--porcelain", "-uall"), /wip-draft\.md/, "the stray file should still be uncommitted");
  const committed = git("show", "--name-only", "--format=", "HEAD");
  assert.doesNotMatch(committed, /wip-draft/);
  assert.match(committed, /re\/tool-notes\/ghidra\.md/);
  fs.rmSync(stray);
});

test("search_knowledge finds a hit despite a typo", async () => {
  const r = await call("search_knowledge", { query: "IsDebugerPresent" });
  assert.equal(r.isError, false);
  assert.match(r.text, /re\/patterns\/anti-debug\.md/);
});

test("read_index returns the generated index", async () => {
  const { text } = await call("read_index");
  assert.match(text, /^# Knowledge Vault — Index/);
  assert.match(text, /## Last updated: \d{4}-\d{2}-\d{2}/);
});

test.after(async () => {
  await client.close();
  fs.rmSync(vault, { recursive: true, force: true });
});
