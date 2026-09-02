<!-- summary: Census a mapped guest null page instead of unmapping it, A null guard outside t… -->
# static-recompilation-debugging

## Census a mapped guest null page instead of unmapping it

A static recompiler that maps guest memory with a flat offset — `host = guest + offset`, with the mapping starting at guest 0 — has guest virtual address 0 mapped **by construction**. A null pointer dereference in lifted code therefore does not fault. It quietly returns 0, or returns whatever an earlier null-derived write left there.

This hides an entire class of bug indefinitely. In one Xbox recompilation project, three separate walls had the same invisible cause: a function walked a NULL object for a whole loop, writing to guest VA 0xC and reading it back next iteration as if it were a live object; an allocator lookup returned NULL and the code did `MEM32(0)` to fetch an indirect-call target, getting 0 rather than a fault; and two guards zeroed a bad pointer and then dereferenced it.

The obvious response — unmap page 0 so it faults — is usually wrong, for two reasons.

First, it may regress a real fix. Low memory is often deliberately left as readable zeros because something in the boot path reads it; in this project that had resolved a 7.6-million-iteration spin. Unmapping reintroduces the spin and buries the thing you were trying to see.

Second, unmapping gives you exactly one data point: the first hit kills the run. What you actually want is the whole list.

Do this instead. Make the page `PAGE_NOACCESS`, install a vectored exception handler, and on each fault **record and resume** rather than die:

- record the guest offset, whether it was a read or a write, and the faulting host RIP (plus its RVA, so it resolves against a linker map)
- flip the page to `PAGE_READWRITE`, set the single-step flag, return `EXCEPTION_CONTINUE_EXECUTION`
- on the single-step trap, restore `PAGE_NOACCESS` and continue

One boot then yields the complete census instead of the first hit. Print it incrementally as well as at shutdown, because the run may well crash before shutdown.

Read the read/write split first, before theorising. It reframes the problem immediately. A census showing 22,382 reads against 21 writes says the page is not being corrupted by a stray write — it is being *read* by pointers that are already wrong, and the bug is upstream of the page entirely. That single ratio killed a plausible standing hypothesis (a thread-local segment base left at 0, so `fs:[0x20]` stores would land at guest 0x20) in one line: guest 0x20 turned out to be read and never written.

Rank the sites by access count. The distribution is usually extremely skewed — here two adjacent instructions in one function were 91% of all traffic — so one function is worth more attention than the other seventy-odd combined.

Build it behind a compile-time flag in a **separate build directory**, the way a sanitiser build is kept separate. It changes timing, so coverage and progress numbers measured on it are meaningless. Say so in the build script, the header and the startup banner, because someone will otherwise quote its numbers back at you.

## A null guard outside the loop is not a null guard inside it

When a census or watchpoint says an instruction dereferences a null pointer thousands of times, and reading the source shows that pointer is null-checked a few lines earlier, do not conclude the check is broken. Check *where the check runs relative to the loop*.

The case that produced this note looked like a flat contradiction. The lifted C read:

```c
loc_00209655: edi = eax; if (TEST_Z(edi, edi)) goto loc_002096A8;
loc_00209666: eax = MEM32(edi);              /* census: reads guest 0, 19,390x */
              icall MEM32(eax + esi * 4);
loc_0020966B: esi++; if (CMP_L(esi, ebx)) goto loc_00209666;
```

`TEST_Z` was correct — `((a) & (b)) == 0`, operand-based, not a stale-flags model. Yet the read still landed on guest 0 every time. Both could not be true.

They both were. `loc_00209666` is a **loop back-edge target**. The guard runs once, on entry, and the loop body then makes an indirect call each iteration. Nothing re-checks. So the guard being correct and the pointer being null at that instruction are entirely compatible, and the real question is what changes the register *inside* the loop.

Two lessons generalise.

**Resolve source-line attribution with the compiler, not by reading.** An optimised build reorders basic blocks, so listing offsets do not follow source order. Here a third census site at `+0x3b9` read guest 0x4 and turned out to be the `MEM32(edi + 4)` from a source line *earlier* than both hot sites. Guessing which C statement an address belongs to is how you build a confident wrong theory.

MSVC will tell you exactly. Pull the compile command out of the build system (`ninja -t commands`, or `compile_commands.json`), re-run it on that one translation unit with `/FAsc`, and read the listing: it interleaves source lines with assembly and per-function offsets, and those offsets match the linked image's symbol offsets directly. GCC/Clang equivalents are `-Wa,-adhln` or `objdump -dS`.

The same listing also identifies which host register holds which guest register, because the prologue loads them from named globals — `mov r15d, OFFSET FLAT:g_edi`. That turns `mov ecx, [r14+r15]` from a guess into a fact, and it is what confirmed the guard had compiled correctly in the first place.

**Prefer two independent measurements over one good story.** The theory here — that an indirect callee was clobbering the register — only became a diagnosis when a second, unrelated instrument (a callee-saved register check on indirect calls) reported that register being clobbered to exactly 0 and 4, the same two values the page-zero census had recorded at the two sites. One measurement plus a plausible mechanism is a hypothesis. Two instruments agreeing on a specific pair of values is a finding.

## Check callee-saved registers across indirect calls, not just direct ones

A static recompiler that keeps the guest CPU state in globals (`g_eax`, `g_ebx`, `g_edi`, …) has no machine-level enforcement of the guest ABI. On x86, `ebx`, `esi`, `edi` and `ebp` are callee-saved under cdecl, stdcall and thiscall, and the original code was compiled assuming that. If a lifted callee returns without restoring them, its caller reads a register the source code was entitled to treat as intact — and nothing crashes at the point of the mistake.

The check is cheap: snapshot those globals before the call, compare after, report once per callee.

```c
#define ABI_CALL(fn) do {                                        \
    uint32_t b = g_ebx, s = g_esi, d = g_edi;                    \
    fn();                                                        \
    if (g_ebx != b || g_esi != s || g_edi != d)                  \
        abi_violation(#fn, b, s, d);                             \
} while (0)
```

**The trap is applying it only to direct calls.** `#fn` needs a literal name, so the macro naturally covers `call sub_XXXX` and stops there. Indirect calls — `call [reg]`, vtable dispatch, function-pointer tables — go through a different code path, and in the project this note comes from that path checked only whether `esp` had escaped the stack. Roughly a third of the violations in the build were invisible for that reason: 14 indirect against 21 direct.

Indirect calls are where you most need the check, because they are exactly where a recompiler substitutes a stub. A missing target falls back to a generic no-op, and a no-op that does not reproduce the real callee's register discipline silently violates the ABI on every invocation.

For the indirect version, report the **target VA** rather than a symbol. There is no name available, and the VA is the more useful identifier anyway — it maps straight back to the disassembly and tells you whether the target was ever lifted at all. Deduplicate per target rather than once globally: the first offender would otherwise hide every other one.

Two things to expect in the output.

Lifter fragments will trip it. Recompilers that split functions at branch targets produce fragments whose pushes are matched by a pop in a sibling fragment, so in isolation a fragment looks unbalanced while the pair is fine. Cross-check a name against a static push/pop-pairing analysis before treating it as a bug.

Clusters of near-adjacent addresses — six hits spread over a 0x5C range — are the shape of a thunk family, not six independent defects. Treat the cluster as one finding.

Finally: before building any of this, grep the codebase for it. The project already had both the page-zero trap and the direct-call ABI checker, written earlier and forgotten, and both were nearly reimplemented from scratch. In a long-running investigation the diagnostic you need has often already been built and left behind a compile flag. Search for the flag before writing the tool.

## A pointer that "gets overwritten" is often a freed block, and the allocator is the innocent writer

A field that holds a good pointer, then a bad one, looks like memory corruption and invites a hunt for whoever wrote the bad value. Check first whether the block was **freed** - because then the writer is the allocator doing its job, and the defect is upstream at the free.

Worked example, X-Men Legends wall 42. A holder's field 0 changed `01091B30` -> `0109863C` and the recorded diagnosis was "its table pointer is OVERWRITTEN". It was not:

1. **Read the "overwriting" function.** It was a dlmalloc `free`: chunk header at `param_1-4`, small-bin push `*(chunk+4) = bin[(size>>3)-1]`, backward coalescing, trim. The mystery write was a **free-list link landing in the freed block**.
2. **Read what the caller passes.** `FUN_0020EEE0` was recorded as "reallocates/shrinks". It actually unlinks a list node and frees its `param_1` - and the caller passed its own `this`, so it freed the holder.
3. **The corrupted "table header" is allocator metadata.** `count` read as a pointer, `array` as `0x680` - a bin link and a chunk size, read as struct fields.

**The tell.** When a struct's fields read as "one plausible pointer plus one small integer", suspect free-list bookkeeping rather than a half-initialised object. Real uninitialised data is usually zeros or a repeated fill pattern; allocator metadata looks like *almost*-valid pointers.

**Then find the repeat visit, not the writer.** An entry probe showed the same `this` on all three calls to the release function, and `recomp_where` stacks showed the frame pair `sub_001EA640 / sub_001F8180` **repeating verbatim** - depth 0, 1, 2. One recursive teardown releasing the same node once per level; the first release frees it, the rest use it after free.

Comparing whole stacks between a healthy call and the fatal one is what makes this visible. The top frames were identical in all three; only the repeated middle pair distinguished them. A single stack from the fatal call alone would not have shown it.

**Do not guard the reader.** Range-checking the crash site would hide a use-after-free and move the fault somewhere non-deterministic. The fix belongs at whatever causes the second visit.</details>
</invoke>
