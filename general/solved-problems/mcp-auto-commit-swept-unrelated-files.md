<!-- summary: Auto-commit in an MCP write tool used git add -A and swallowed unrelated work in progress -->
# mcp-auto-commit-swept-unrelated-files

**Technique:** Stage and commit by explicit pathspec instead of -A, and pin it with a test that leaves a stray file dirty

## Notes

## Symptom

The knowledge-vault MCP server commits and pushes after every write tool. While verifying the push path by hand, a temporary driver script sitting in the repo turned up inside the commit that `save_pattern` had made. Nobody asked for it to be committed.

## Cause

`commitAndPush` ran `git add -A`, which stages the entire working tree, not just the files the tool wrote. Any unrelated edit, draft, or scratch file that happened to be dirty in the vault at that moment got swept into an auto-commit and pushed to the remote. The user never sees a diff before this happens — the tool commits as a side effect of saving a note.

This is worse than it first looks: the whole point of the vault is that a write is a small, self-describing commit. `-A` silently breaks that, and the commit message still claims to be about one pattern.

## Fix

Pass the paths each tool actually touched into `commitAndPush`, then use them as a pathspec on both commands:

```
git add -- <paths> INDEX.md
git commit -m <msg> -- <paths> INDEX.md
```

The pathspec on `commit` matters as much as the one on `add` — without it, anything the user had staged by hand still rides along, because `git commit` otherwise commits the whole index.

Two details worth remembering:

- Filter the path list to those that exist before passing them. The attachments directory is only created when a note actually has screenshots, and `git add` on a non-existent pathspec is a hard error.
- Scope the "is there anything to commit" check to the same pathspec (`git diff --cached --name-only -- <paths>`), otherwise unrelated staged files make it look like there is work to do.

## Check that pins it

A test writes a stray file into the vault, calls a write tool, and then asserts the stray file is still dirty afterwards and absent from `HEAD`:

```
assert.match(git("status", "--porcelain", "-uall"), /wip-draft\.md/)
assert.doesNotMatch(git("show", "--name-only", "--format=", "HEAD"), /wip-draft/)
```

Use `-uall` on status: plain `--porcelain` collapses an untracked directory to a single `dir/` entry, so a naive match on the filename fails even though the behaviour is correct. That cost a confusing red test before the assertion was fixed.

## Generalisation

Any agent-triggered commit should name its own files. `git add -A` is only safe when a human is looking at the diff first.
