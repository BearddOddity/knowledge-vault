# Knowledge Vault — Index

## general

### Solved problems
- general/solved-problems/mcp-auto-commit-swept-unrelated-files.md — Auto-commit in an MCP write tool used git add -A and swallowed unrelated work in progress

## re

### Patterns
- re/patterns/anti-debug.md — IsDebuggerPresent, NtQueryInformationProcess, NtSetInformationThread (ThreadHid… (3 techniques logged)
- re/patterns/bytecode-vm-crackmes.md — Recognise a VM from the section-size ratio, then attack it one level up: count… (7 techniques logged)
- re/patterns/code-a-disassembler-never-turned-into-a-function.md — A table nothing appears to write usually has a writer that was never promoted t… (6 techniques logged)
- re/patterns/console-sdk-coverage-in-ghidra.md — Signature databases and SDK headers are worth far more combined than separately… (8 techniques logged)
- re/patterns/ghidra-decompilation.md — Varargs hide arithmetic until the prototype is set (1 technique logged)
- re/patterns/making-a-wsl2-distro-behave-like-a-real-linux-pc.md — systemd via wsl.conf and a clipboard bridge between the nested X server and WSL… (5 techniques logged)
- re/patterns/naming-a-large-game-binary-at-scale.md — RTTI vtable walking names thousands at once and beats every other source combin… (6 techniques logged)
- re/patterns/packers.md — UPX with renamed sections, and unpacking by running instead (1 technique logged)
- re/patterns/separating-engine-platform-and-game-code-across-binaries.md — One title built for two platforms pins the platform layer exactly; more titles… (6 techniques logged)
- re/patterns/stabs-debug-symbols-in-mingw-binaries.md — Check for .stab/.stabstr sections before assuming locals are anonymous - GCC/Mi… (1 technique logged)
- re/patterns/static-recompilation-debugging.md — Census a mapped guest null page instead of unmapping it, A null guard outside t… (4 techniques logged)
- re/patterns/vb6.md — Detect P-code before disassembling, and attack it dynamically, Locating P-code… (3 techniques logged)

### Solved problems
- re/solved-problems/alchemy-class-registry-recovered-from-x-men-legends.md — Recovered 696 class names, their sizes, inheritance and 2,110 attributable functions from the game's own startup registration table, after two external symbol sources had largely failed
- re/solved-problems/bfcrackme40-keygen.md — Keygen recovered by disassembling VB6 P-code; the check is a string range, not an equality
- re/solved-problems/bfcrackme40-partial.md — UPX-0.82 VB6 P-code crackme: unpacked and valid serials found, but no general keygen yet
- re/solved-problems/crackme01-pipeline-validation.md — First end-to-end run of the RE pipeline: triage to keygen on a self-authored 32-bit PE
- re/solved-problems/keygen-2-by-nicohogtag.md — Shipped STABS debug symbols named every local, turning the check into readable C; the algorithm reads two bytes past its input buffer, so the expected serial depends on the saved EBP.
- re/solved-problems/prime-exe-crackmes-one.md — Password recovered by inverting pow(129, char, 251) then XOR - the character was the exponent
- re/solved-problems/qvm32.md — A bytecode VM whose interpreter hides the password check from x86 tracing; the oracle is VM instructions executed, not x86 instructions.
- re/solved-problems/x-men-legends-xbox-analysis-campaign.md — Took an Xbox game binary from 714 named functions to 4,560 and split its 15,742 functions into platform, engine and game code, using RTTI vtable walking plus cross-binary hash comparison against four related builds.

### Tool notes
- re/tool-notes/finding-vtables-without-rtti.md (4 notes)
- re/tool-notes/ghidra.md (2 notes)
- re/tool-notes/guest-watchpoints.md (1 note)
- re/tool-notes/moving-a-ghidra-project-between-machines-or-users.md (7 notes)
- re/tool-notes/qt6-gui-apps-under-wslg.md (1 note)
- re/tool-notes/re-lab-mcp.md (1 note)

## Last updated: 2026-09-02
