# guest-watchpoints

## **A page-protection watchpoint that reports MISSED WRITES i…

**A page-protection watchpoint that reports MISSED WRITES is giving you no evidence, not negative evidence.**

Two instruments for "who wrote this guest address?" in a static recompilation, and they fail differently.

**Page-protection watchpoint.** Marks the guest page PAGE_NOACCESS and reports the faulting access. It cannot see a write that lands while the page is temporarily unprotected, and it says so by emitting `MISSED WRITES`.

**Software poll.** Samples the watched value after every recompiled call and names the callee. Sample *before* the call as well as after - an after-only sample bounds a whole subtree instead of naming one function.

Measured failure, 2026-09-02: the page watchpoint reported **33 hits all reading `00000000`** on an address that a probe proved was live and changing, and emitted `MISSED WRITES` once. Taking those zeros at face value produced a confident wrong conclusion - "the object is not at this address, the heap layout must have shifted between builds" - which then justified abandoning a correct address. The software poll on the same address answered immediately: `01091B30 -> 0109863C across sub_0020AA90`.

Rules that follow:

- When the poll and the page watchpoint disagree, the **poll wins**.
- A watchpoint run containing `MISSED WRITES` is unusable. Do not reason from its silence.
- Zeros from a watchpoint are not proof the memory is unused. Confirm with an entry probe that prints the value directly.
- Prefer a **4-byte watch on the exact field** over a byte range. Watching a 16-byte span produced one hit per byte per access and buried the signal.

**Redirection trap.** If the recompiled executable is built for the WIN32 subsystem it detaches from the console, and PowerShell's `>`/`2>` capture nothing - you get an empty log that is indistinguishable from "the watchpoint never fired". Run it from a `.bat` so `cmd` does the redirection.
