# status-page-skill

## A project-agnostic skill in the `oddity-re` plugin (2.1.0),…

A project-agnostic skill in the `oddity-re` plugin (2.1.0), beside `skill-manager`. It publishes a visual progress report for any project: a progress bar, categorised breakdowns, findings in plain language, ordered next steps, and a caveat section. Source of truth is `D:\My apps\Reverse Engineer Brain\oddity-skills\plugins\oddity-re\skills\status-page\SKILL.md`.

## Why it exists, and the rule that is the whole point

Layout is not the hard part of a status report. The honest number is. A made-up percentage reads as authoritative, is worthless, and gets quoted back weeks later when nobody remembers where it came from.

**A percentage needs a denominator you can point at.** Real ones: tests passing over total, tasks done over total, modules implemented over specified, items processed over items found, milestones passed over planned, coverage from a coverage tool. Where none exists the page says so in one line - "No completion percentage: this project has no fixed scope to measure against" - and shows direction of travel instead. A trend is honest where a percentage is not.

**Two denominators never average into one number.** Tests at 80% and tasks at 40% is two bars, not one 60%. That is the subtle version of the same mistake and it gets its own rule, because averaging invents a measurement nobody made.

## The four things ordinary status reports skip, which this one requires

1. **What was FOUND**, not merely what was done - with what was believed, what turned out to be true, the evidence, and what it cost. Including findings later refuted: a page that lists only wins is not trusted.
2. **Explicit dependency between next steps** - which one blocks which.
3. **Naming anything blocked on a person or a decision** rather than on work. Often the single most useful line on the page.
4. **A caveat section that may not be dropped when the news is good.** Its absence reads as concealment.

## Structure

Five sections, in the order a reader asks the questions: where it stands (one plain sentence, then the bars, each labelled with its denominator in full) - what was done (grouped by area, never by commit) - what was found - what happens next - the honest caveat.

## Boundaries, deliberately

Design is delegated to `artifact-design` and any chart beyond a labelled bar to `dataviz`, so the skill stays about *what belongs on the page* rather than duplicating either. A progress bar is a labelled div, not a charting dependency.

It also insists on running the test or build command rather than describing it, since a status page built on a stale number is the exact failure it exists to prevent; where the command cannot be run, the figure is labelled with when it was last measured.

## Prior art in this workspace

`src/game/tools_data/gen_status_page.py` in the recompilation project is this skill already written by hand for one project - it emits the page from `progress.json` and the current run's log. That is the pattern the skill recommends for any project that will want the page often: generate it from the project's own data with a committed script, because a page rebuilt by a command stays true while one rebuilt from memory drifts.

## Editing and shipping

Edit in `oddity-skills`, bump the version in both `plugins/oddity-re/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, then `claude plugin marketplace update oddity`, `claude plugin uninstall oddity-re --scope user`, `claude plugin install oddity-re@oddity --scope user`. `claude plugin update` does not work on a local marketplace. For immediate use without a reinstall the skill directory can be copied straight into `~/.claude/plugins/cache/oddity/oddity-re/<version>/skills/`.

Assigned as a standing power in both `D:\My apps\Reverse Engineer Brain` and `D:\My Games\Xbox Recomp`, whose rosters are kept identical.
