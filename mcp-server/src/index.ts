#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import Fuse from "fuse.js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const VAULT = process.env.KNOWLEDGE_VAULT_PATH;
if (!VAULT) {
  console.error("KNOWLEDGE_VAULT_PATH is not set. Point it at the knowledge-vault repo root.");
  process.exit(1);
}
const ROOT = path.resolve(VAULT);
if (!fs.existsSync(ROOT)) {
  console.error(`KNOWLEDGE_VAULT_PATH does not exist: ${ROOT}`);
  process.exit(1);
}

/** Directories at the repo root that are never categories. */
const NON_CATEGORY = new Set(["mcp-server", "node_modules", ".git", ".github"]);

const TYPE_DIR = {
  pattern: "patterns",
  "solved-problem": "solved-problems",
  "tool-note": "tool-notes",
} as const;
type EntryType = keyof typeof TYPE_DIR;

// ---------------------------------------------------------------- helpers

/** Filesystem-safe slug. Also the guard against path traversal. */
function slug(raw: string, label: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|-+$/g, "");
  if (!s || s === "." || s === "..") {
    throw new Error(`Invalid ${label}: ${JSON.stringify(raw)} contains no usable characters.`);
  }
  return s;
}

function required(value: string | undefined, label: string): string {
  if (!value || !value.trim()) throw new Error(`${label} must not be empty.`);
  return value.trim();
}

/** Resolve a path inside the vault, refusing anything that escapes it. */
function inVault(...parts: string[]): string {
  const p = path.resolve(ROOT, ...parts);
  if (p !== ROOT && !p.startsWith(ROOT + path.sep)) {
    throw new Error(`Refusing to touch a path outside the vault: ${p}`);
  }
  return p;
}

function listCategories(): string[] {
  return fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !NON_CATEGORY.has(d.name))
    .filter((d) => Object.values(TYPE_DIR).some((t) => fs.existsSync(path.join(ROOT, d.name, t))))
    .map((d) => d.name)
    .sort();
}

/** Create the category and its three subfolders if this is a new category. */
function ensureCategory(category: string): string {
  const c = slug(required(category, "category"), "category");
  for (const dir of Object.values(TYPE_DIR)) fs.mkdirSync(inVault(c, dir), { recursive: true });
  return c;
}

/**
 * Every entry file carries its index summary as an HTML comment on line 1:
 * invisible when rendered, trivial to parse back out when rebuilding INDEX.md.
 */
const SUMMARY_RE = /^<!--\s*summary:\s*(.*?)\s*-->[ \t]*$/m;

function readSummary(file: string): string {
  const m = fs.readFileSync(file, "utf8").match(SUMMARY_RE);
  return m ? m[1] : "";
}

function writeSummary(file: string, summary: string): void {
  const body = fs.readFileSync(file, "utf8");
  const line = `<!-- summary: ${summary.replace(/\r?\n/g, " ")} -->`;
  fs.writeFileSync(file, SUMMARY_RE.test(body) ? body.replace(SUMMARY_RE, line) : `${line}\n${body}`);
}

function mdFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
}

/** Count the `## ` headings in a file — one per appended technique or note. */
function countSections(file: string): number {
  return (fs.readFileSync(file, "utf8").match(/^## .+$/gm) || []).length;
}

function truncate(s: string, n = 80): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// --------------------------------------------------------------- INDEX.md

/**
 * INDEX.md is regenerated from a scan of the tree rather than appended to, so it
 * cannot drift out of sync with the files and it self-heals after hand edits.
 */
function rebuildIndex(): void {
  const out: string[] = ["# Knowledge Vault — Index", ""];

  for (const cat of listCategories()) {
    const sections: string[] = [];

    const patterns = mdFiles(inVault(cat, "patterns"));
    if (patterns.length) {
      sections.push("### Patterns");
      for (const f of patterns) {
        const full = inVault(cat, "patterns", f);
        const desc = readSummary(full);
        sections.push(
          `- ${cat}/patterns/${f}${desc ? ` — ${desc}` : ""} (${plural(countSections(full), "technique")} logged)`
        );
      }
      sections.push("");
    }

    const solved = mdFiles(inVault(cat, "solved-problems"));
    if (solved.length) {
      sections.push("### Solved problems");
      for (const f of solved) {
        const desc = readSummary(inVault(cat, "solved-problems", f));
        sections.push(`- ${cat}/solved-problems/${f}${desc ? ` — ${desc}` : ""}`);
      }
      sections.push("");
    }

    const tools = mdFiles(inVault(cat, "tool-notes"));
    if (tools.length) {
      sections.push("### Tool notes");
      for (const f of tools) {
        sections.push(`- ${cat}/tool-notes/${f} (${plural(countSections(inVault(cat, "tool-notes", f)), "note")})`);
      }
      sections.push("");
    }

    // An existing but empty category is still listed, so it is discoverable.
    out.push(`## ${cat}`, "", ...(sections.length ? sections : ["_(empty)_", ""]));
  }

  out.push(`## Last updated: ${new Date().toISOString().slice(0, 10)}`, "");
  fs.writeFileSync(inVault("INDEX.md"), out.join("\n"));
}

// -------------------------------------------------------------------- git

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitError(e: any): string {
  return (e?.stderr || e?.message || String(e)).toString().trim();
}

/**
 * Commit and push. A failed push is reported, never swallowed: the local commit
 * still stands, so the caller is told exactly what did and did not happen.
 */
function commitAndPush(message: string): string {
  try {
    git(["add", "-A"]);
    if (!git(["diff", "--cached", "--name-only"])) return "No file changes to commit.";
    git(["commit", "-m", message]);
  } catch (e) {
    return `Files written, but git commit FAILED: ${gitError(e)}`;
  }
  try {
    if (!git(["remote"])) return `Committed "${message}". Push skipped: no git remote is configured.`;
    git(["push"]);
    return `Committed and pushed: "${message}".`;
  } catch (e) {
    return `Committed "${message}" locally, but PUSH FAILED: ${gitError(e)}`;
  }
}

// ----------------------------------------------------------------- search

function allMarkdown(): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  const walk = (dir: string) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (d.name.startsWith(".") || NON_CATEGORY.has(d.name)) continue;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) walk(full);
      else if (d.name.endsWith(".md")) {
        files.push({ path: path.relative(ROOT, full).replace(/\\/g, "/"), content: fs.readFileSync(full, "utf8") });
      }
    }
  };
  walk(ROOT);
  return files;
}

/** Lines containing any word of the query, for a readable snippet under each hit. */
function snippets(content: string, query: string, limit = 3): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return content
    .split(/\r?\n/)
    .filter((l) => l.trim() && words.some((w) => l.toLowerCase().includes(w)))
    .slice(0, limit)
    .map((l) => truncate(l.trim(), 160));
}

// ----------------------------------------------------------------- server

const server = new McpServer({ name: "knowledge-vault", version: "0.1.0" });
const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

const categoryArg = z.string().describe("Category folder, e.g. 're' or 'general'. Created automatically if new.");

server.registerTool(
  "read_index",
  {
    title: "Read vault index",
    description:
      "Return the full contents of INDEX.md, the table of contents for the knowledge vault. Call this first in any session that touches the vault.",
    inputSchema: {},
  },
  async () => {
    const file = inVault("INDEX.md");
    if (!fs.existsSync(file)) return text("INDEX.md does not exist yet. Save an entry to create it.");
    return text(fs.readFileSync(file, "utf8"));
  }
);

server.registerTool(
  "list_categories",
  {
    title: "List categories",
    description:
      "List the top-level categories that exist in the vault (e.g. re, general). New categories are created on demand by the save tools.",
    inputSchema: {},
  },
  async () => {
    const cats = listCategories();
    return text(cats.length ? cats.join("\n") : "No categories yet.");
  }
);

server.registerTool(
  "get_entry",
  {
    title: "Get entry",
    description: "Return the full contents of one vault file.",
    inputSchema: {
      category: categoryArg,
      type: z.enum(["pattern", "solved-problem", "tool-note"]),
      name: z.string().describe("File name without the .md extension, e.g. 'anti-debug'."),
    },
  },
  async ({ category, type, name }) => {
    const cat = slug(required(category, "category"), "category");
    const file = inVault(cat, TYPE_DIR[type as EntryType], `${slug(required(name, "name"), "name")}.md`);
    if (!fs.existsSync(file)) {
      throw new Error(
        `No such entry: ${path.relative(ROOT, file).replace(/\\/g, "/")}. Use read_index or search_knowledge to see what exists.`
      );
    }
    return text(fs.readFileSync(file, "utf8"));
  }
);

server.registerTool(
  "save_pattern",
  {
    title: "Save pattern",
    description:
      "Append a technique to a pattern file under <category>/patterns/, creating the file and category if needed. Updates INDEX.md, then commits and pushes.",
    inputSchema: {
      category: categoryArg,
      topic: z.string().describe("Pattern file topic, e.g. 'anti-debug'."),
      technique: z.string().describe("Short name of the technique, e.g. 'IsDebuggerPresent'."),
      details: z.string().describe("The write-up: how it works, how to spot it, how to defeat it."),
    },
  },
  async ({ category, topic, technique, details }) => {
    const cat = ensureCategory(category);
    const topicSlug = slug(required(topic, "topic"), "topic");
    const tech = required(technique, "technique");
    const body = required(details, "details");

    const file = inVault(cat, "patterns", `${topicSlug}.md`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${topic.trim()}\n`);
    fs.appendFileSync(file, `\n## ${tech}\n\n${body}\n`);

    // Index summary for a pattern file is the list of technique names it holds.
    const names = (fs.readFileSync(file, "utf8").match(/^## (.+)$/gm) || []).map((h) => h.slice(3).trim());
    writeSummary(file, truncate(names.join(", ")));

    rebuildIndex();
    return text(
      `Saved technique "${tech}" to ${cat}/patterns/${topicSlug}.md (${plural(names.length, "technique")} total).\n` +
        commitAndPush(`Add pattern: ${topicSlug} — ${tech} (${cat})`)
    );
  }
);

server.registerTool(
  "log_solved_problem",
  {
    title: "Log solved problem",
    description:
      "Create a write-up under <category>/solved-problems/ for any solved bug, puzzle, or challenge. Optionally copies reference screenshots into the vault. Updates INDEX.md, then commits and pushes.",
    inputSchema: {
      category: categoryArg,
      name: z.string().describe("Short name for the problem, used as the file name."),
      summary: z.string().describe("One line for the index."),
      technique: z.string().describe("The technique or approach that cracked it."),
      fullNotes: z.string().describe("The full write-up."),
      screenshotPaths: z
        .array(z.string())
        .optional()
        .describe("Absolute paths to reference images to copy into the vault. Images only — never executables."),
    },
  },
  async ({ category, name, summary, technique, fullNotes, screenshotPaths }) => {
    const cat = ensureCategory(category);
    const nameSlug = slug(required(name, "name"), "name");
    const sum = required(summary, "summary");
    const tech = required(technique, "technique");
    const notes = required(fullNotes, "fullNotes");

    const file = inVault(cat, "solved-problems", `${nameSlug}.md`);
    if (fs.existsSync(file)) {
      throw new Error(`${cat}/solved-problems/${nameSlug}.md already exists. Pick a different name, or edit the file directly.`);
    }

    // Reference images only. Binaries stay out of the repo: bloat, GitHub file
    // scanning, and redistribution problems with third-party challenge files.
    const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);
    const links: string[] = [];
    for (const src of screenshotPaths ?? []) {
      const ext = path.extname(src).toLowerCase();
      if (!IMAGE_EXT.has(ext)) {
        throw new Error(`Refusing to copy ${src}: only image files are allowed as attachments, never executables or archives.`);
      }
      if (!fs.existsSync(src)) throw new Error(`Screenshot not found: ${src}`);
      const destDir = inVault(cat, "attachments", nameSlug);
      fs.mkdirSync(destDir, { recursive: true });
      const fileName = slug(path.basename(src, ext), "screenshot name") + ext;
      fs.copyFileSync(src, path.join(destDir, fileName));
      links.push(`![${fileName}](../attachments/${nameSlug}/${fileName})`);
    }

    const doc = [
      `<!-- summary: ${sum} -->`,
      `# ${name.trim()}`,
      "",
      `**Technique:** ${tech}`,
      "",
      "## Notes",
      "",
      notes,
      ...(links.length ? ["", "## Screenshots", "", ...links] : []),
      "",
    ].join("\n");
    fs.writeFileSync(file, doc);

    rebuildIndex();
    return text(
      `Logged ${cat}/solved-problems/${nameSlug}.md` +
        (links.length ? ` with ${plural(links.length, "screenshot")}` : "") +
        `.\n` +
        commitAndPush(`Log solved problem: ${nameSlug} (${cat})`)
    );
  }
);

server.registerTool(
  "save_tool_note",
  {
    title: "Save tool note",
    description:
      "Append a note to <category>/tool-notes/<tool>.md, creating it if needed. Updates INDEX.md, then commits and pushes.",
    inputSchema: {
      category: categoryArg,
      tool: z.string().describe("Tool name, e.g. 'ghidra' or 'x64dbg'."),
      note: z.string().describe("The note to append."),
    },
  },
  async ({ category, tool, note }) => {
    const cat = ensureCategory(category);
    const toolSlug = slug(required(tool, "tool"), "tool");
    const body = required(note, "note");

    const file = inVault(cat, "tool-notes", `${toolSlug}.md`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${tool.trim()}\n`);

    const heading = truncate(body.split(/\r?\n/)[0], 60);
    fs.appendFileSync(file, `\n## ${heading}\n\n${body}\n`);

    rebuildIndex();
    return text(
      `Appended note to ${cat}/tool-notes/${toolSlug}.md (${plural(countSections(file), "note")} total).\n` +
        commitAndPush(`Add tool note: ${toolSlug} (${cat})`)
    );
  }
);

server.registerTool(
  "search_knowledge",
  {
    title: "Search knowledge",
    description:
      "Fuzzy search every markdown file in the vault. Returns matching file paths with snippets, ranked by relevance.",
    inputSchema: {
      query: z.string().describe("What to look for. Typos and partial words are tolerated."),
      limit: z.number().int().min(1).max(50).optional().describe("Maximum number of files to return (default 10)."),
    },
  },
  async ({ query, limit }) => {
    const q = required(query, "query");
    const files = allMarkdown();
    if (!files.length) return text("The vault has no markdown files yet.");

    const fuse = new Fuse(files, {
      keys: [
        { name: "path", weight: 2 },
        { name: "content", weight: 1 },
      ],
      includeScore: true,
      ignoreLocation: true,
      threshold: 0.4,
      minMatchCharLength: 3,
    });

    const hits = fuse.search(q).slice(0, limit ?? 10);
    if (!hits.length) return text(`No matches for ${JSON.stringify(q)}.`);

    const out = hits.map((h) => {
      const lines = snippets(h.item.content, q);
      const score = (1 - (h.score ?? 0)).toFixed(2);
      return [`## ${h.item.path}  (relevance ${score})`, ...lines.map((l) => `  ${l}`)].join("\n");
    });
    return text(`${plural(hits.length, "match")} for ${JSON.stringify(q)}:\n\n${out.join("\n\n")}`);
  }
);

async function main() {
  await server.connect(new StdioServerTransport());
  console.error(`knowledge-vault MCP server ready. Vault: ${ROOT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
