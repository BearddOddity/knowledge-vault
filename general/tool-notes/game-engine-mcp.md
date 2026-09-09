<!-- summary: Lightweight stdio MCP server for querying open-source game-engine repositories. Seeded with OGRECave, Godot, Bevy, and s&box. Used to pull engine feature and repository metadata for Athanor reference. -->

# game-engine MCP

## What it is

A local stdio MCP server that provides read-only access to a curated catalog of open-source game engine GitHub repositories, plus live GitHub API lookups.

**Location:** `D:\My apps\Reverse Engineer Brain\game-engine-mcp\`
**Runtime:** Node.js, TypeScript, `@modelcontextprotocol/sdk`
**Transport:** stdio
**Built entrypoint:** `D:\My apps\Reverse Engineer Brain\game-engine-mcp\dist\index.js`

## Why it exists

Athanor needs quick access to engine feature sets, repository metadata, and cross-engine comparisons without leaving the session. This MCP keeps a stable local catalog and supplements it with live GitHub data.

## Catalog entries

- `ogre-next` — OGRECave/ogre-next
- `ogre` — OGRECave/ogre
- `blender2ogre` — OGRECave/blender2ogre
- `ogitor` — OGRECave/ogitor
- `ogre-meshviewer` — OGRECave/ogre-meshviewer
- `ogre-caelum` — OGRECave/ogre-caelum
- `ogre-procedural` — OGRECave/ogre-procedural
- `ogre-pagedgeometry` — OGRECave/ogre-pagedgeometry
- `ogre-audiovideo` — OGRECave/ogre-audiovideo
- `ogrewater` — OGRECave/ogrewater
- `godot` — godotengine/godot
- `godot-docs` — godotengine/godot-docs
- `bevy` — bevyengine/bevy
- `sbox-public` — Facepunch/sbox-public

## Tools

| Tool | Purpose |
|---|---|
| `list_sources` | Return all catalog entries with metadata |
| `get_repo_info(owner, repo)` | Live GitHub metadata: stars, forks, license, topics, default branch |
| `list_org_repos(org)` | List public source repos for an org, e.g. `OGRECave` |
| `search_sources(query)` | Case-insensitive search across name, description, language, topics |
| `compare_engine_features(names)` | Compact feature summary for named catalog entries |

## Claude Code registration

```bash
claude mcp add game-engine -- node "D:\My apps\Reverse Engineer Brain\game-engine-mcp\dist\index.js"
```

## Usage notes

- Catalog is static until rebuilt. To add a repo, edit `src/index.ts`, run `npm run build`, then restart the MCP.
- `get_repo_info` hits the GitHub API directly and returns live data.
- `list_org_repos` caps at 100 public repos per org.
- No auth token is configured; unauthenticated GitHub API rate limits apply.
