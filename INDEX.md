# Knowledge Vault — Index

## general

### Solved problems
- general/solved-problems/mcp-auto-commit-swept-unrelated-files.md — Auto-commit in an MCP write tool used git add -A and swallowed unrelated work in progress

## re

### Patterns
- re/patterns/anti-debug.md — IsDebuggerPresent, NtQueryInformationProcess, NtSetInformationThread (ThreadHid… (3 techniques logged)
- re/patterns/bytecode-vm-crackmes.md — Recognise a VM from the section-size ratio, then attack it one level up: count… (7 techniques logged)
- re/patterns/ghidra-decompilation.md — Varargs hide arithmetic until the prototype is set (1 technique logged)
- re/patterns/making-a-wsl2-distro-behave-like-a-real-linux-pc.md — systemd via wsl.conf and a clipboard bridge between the nested X server and WSL… (5 techniques logged)
- re/patterns/packers.md — UPX with renamed sections, and unpacking by running instead (1 technique logged)
- re/patterns/stabs-debug-symbols-in-mingw-binaries.md — Check for .stab/.stabstr sections before assuming locals are anonymous - GCC/Mi… (1 technique logged)
- re/patterns/vb6.md — Detect P-code before disassembling, and attack it dynamically, Locating P-code… (3 techniques logged)

### Solved problems
- re/solved-problems/bfcrackme40-keygen.md — Keygen recovered by disassembling VB6 P-code; the check is a string range, not an equality
- re/solved-problems/bfcrackme40-partial.md — UPX-0.82 VB6 P-code crackme: unpacked and valid serials found, but no general keygen yet
- re/solved-problems/crackme01-pipeline-validation.md — First end-to-end run of the RE pipeline: triage to keygen on a self-authored 32-bit PE
- re/solved-problems/keygen-2-by-nicohogtag.md — Shipped STABS debug symbols named every local, turning the check into readable C; the algorithm reads two bytes past its input buffer, so the expected serial depends on the saved EBP.
- re/solved-problems/prime-exe-crackmes-one.md — Password recovered by inverting pow(129, char, 251) then XOR - the character was the exponent
- re/solved-problems/qvm32.md — A bytecode VM whose interpreter hides the password check from x86 tracing; the oracle is VM instructions executed, not x86 instructions.

### Tool notes
- re/tool-notes/ghidra.md (1 note)
- re/tool-notes/qt6-gui-apps-under-wslg.md (1 note)
- re/tool-notes/re-lab-mcp.md (1 note)

## Last updated: 2026-08-29
