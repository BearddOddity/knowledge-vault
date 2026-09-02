<!-- summary: Silent hangs and the stale-checkout trap -->
# tooling-failures

## Silent hangs and the stale-checkout trap

Two failure modes that compound into one another, both observed on a long-running reverse-engineering project split across a Windows host and a WSL lab.

**1. A hang is a worse failure than an error.**

`git fetch` in the lab blocked for 200+ seconds with no output whatsoever. The instinct is to suspect the network; that was wrong. DNS resolved and `curl https://github.com` returned HTTP 200 in 0.29 seconds. The repository was private, the machine had no credential of any kind, and git was blocking on an interactive username prompt that no TTY could ever answer.

The diagnostic that collapses this instantly is to force the failure to speak:

    GIT_TERMINAL_PROMPT=0 git ls-remote origin HEAD

which returns `fatal: could not read Username for 'https://github.com': terminal prompts disabled` in about a second. Export `GIT_TERMINAL_PROMPT=0` permanently in any non-interactive or agent-driven shell. The same principle generalises: any tool that can prompt should be configured to fail instead, because in an automated context a prompt is an infinite hang and an infinite hang is invisible.

**2. Tools inherit the staleness of whatever checkout they read.**

The consequence of that hang was that the lab silently fell 44 commits behind over three weeks. Nobody noticed, because there was never an error to notice. The MCP tooling was configured to run against the lab's checkout, so a `progress` tool kept reporting confidently precise numbers — 226 kernel calls, a crash site from three weeks earlier — while the live tree was at 514 with a completely different crash site. The output looked healthy. It was just answering about a different world.

The rule that falls out: **when a tool's numbers disagree with work you know you did, determine which tree the tool reads before you trust either number.** Check the tool's configured working directory first, not its output. A tool reading a stale checkout produces plausible, internally consistent, entirely misleading answers, and there is nothing in the output itself that reveals the problem.

**Recovering a checkout with no network access:** `git bundle create sync.bundle <base>..<branch>` on the healthy side, move the file through whatever shared folder exists, then `git fetch /path/to/sync.bundle <branch>:refs/remotes/bundle/x` and `git merge --ff-only` on the stranded side. Uncommitted work moves separately as `git diff HEAD --binary` plus a tar of untracked files; `git apply --check` first. Before discarding anything on the stale side, prove it is redundant rather than assuming — compare file hashes and record counts both ways. In this case every one of the lab's local modifications turned out to be byte-identical to the other side or superseded by it, but that was established by measurement, not by hope, and a `git stash push -u` plus a tar backup were taken anyway.

**A note on scope discipline:** the stranded machine deliberately had Windows drives unmounted for isolation, documented in its `wsl.conf`. The quickest fix for the credential problem would have been to mount the host filesystem and reuse the host's credential manager. That would have silently reversed a security decision someone made on purpose. Fixing a tooling problem does not license undoing a safety boundary that happens to be in the way — find the fix that respects it, or ask.
