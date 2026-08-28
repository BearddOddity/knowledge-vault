# Knowledge Vault

A git-backed knowledge base of solved problems, patterns, and tool notes, plus an
MCP server that lets Claude read and write it. Started for reverse engineering,
but the structure is generic — any project can use the same vault.

Everything is plain markdown. There is no database.

## Layout

```
knowledge-vault/
  INDEX.md              generated table of contents — one line per entry
  re/                   a category
    patterns/           recurring techniques, one file per topic
    solved-problems/    one file per solved bug, puzzle, or challenge
    tool-notes/         one file per tool
    attachments/        reference screenshots, grouped by problem name
  general/              same shape
  mcp-server/           the MCP server
```

`INDEX.md` is **regenerated** from a scan of the tree after every write, never
appended to. It cannot drift out of sync, and it repairs itself if you edit files
by hand.

Each entry file carries its index summary as an HTML comment on line one
(`<!-- summary: ... -->`) — invisible when rendered, easy to parse when rebuilding.

## Categories are created on demand

`re` and `general` exist to start with. Any save tool that names a category that
does not exist yet creates it, with its four subfolders, and gives it a section in
the index. Nothing is hardcoded, so `streamersuite`, `status-forge`, or anything
else needs no code change — just pass the name.

## What does not go in here

No executables, binaries, or archives — notes and reference screenshots only.
`.gitignore` blocks the common extensions and `log_solved_problem` refuses any
attachment that is not an image. This keeps the repo small and avoids
redistributing third-party challenge files.

## Setup

```bash
cd mcp-server
npm install
npm run build
npm test
```

The server needs `KNOWLEDGE_VAULT_PATH` pointing at the repo root (the folder
holding `INDEX.md`). It exits with a clear message if that is unset or wrong.

## Connecting it

**Claude Code** — from anywhere:

```bash
claude mcp add knowledge-vault --env KNOWLEDGE_VAULT_PATH="D:\My apps\Reverse Engineer Brain\knowledge-vault" -- node "D:\My apps\Reverse Engineer Brain\knowledge-vault\mcp-server\dist\index.js"
```

**Claude Desktop** — in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "knowledge-vault": {
      "command": "node",
      "args": ["D:\\My apps\\Reverse Engineer Brain\\knowledge-vault\\mcp-server\\dist\\index.js"],
      "env": {
        "KNOWLEDGE_VAULT_PATH": "D:\\My apps\\Reverse Engineer Brain\\knowledge-vault"
      }
    }
  }
}
```

This is a stdio server, so it works with Claude Code and Claude Desktop. Using it
from claude.ai in the browser would require hosting it as a remote MCP server —
not built.

## Tools

| Tool | What it does |
|---|---|
| `read_index()` | Returns `INDEX.md`. Call it first in any session that touches the vault. |
| `list_categories()` | Lists the categories that exist. |
| `get_entry(category, type, name)` | Returns one file. `type` is `pattern`, `solved-problem`, or `tool-note`. |
| `save_pattern(category, topic, technique, details)` | Appends a technique to `<category>/patterns/<topic>.md`. |
| `log_solved_problem(category, name, summary, technique, fullNotes, screenshotPaths?)` | Writes a full write-up under `<category>/solved-problems/`, copying any screenshots into `attachments/`. |
| `save_tool_note(category, tool, note)` | Appends a note to `<category>/tool-notes/<tool>.md`. |
| `search_knowledge(query, limit?)` | Fuzzy search (Fuse.js) across every markdown file, ranked, with snippets. Tolerates typos. |

## Git behaviour

Every write tool does `git add` → `git commit` → `git push` as part of the same
call, with an auto-generated message like `Add pattern: anti-debug — RDTSC timing (re)`.

If the push fails — no network, a conflict, no remote — the tool still reports the
local commit as successful and states plainly that the push failed and why. It is
never swallowed. Re-push by hand with `git push` once the cause is cleared.

## Input validation

Empty or whitespace-only arguments are rejected by name (`topic must not be
empty`). Category and file names are slugified, which also blocks path traversal:
anything resolving outside the vault root is refused.
