<!-- summary: A recompiler that honors a disassembler's function list verbatim truncates real functions at cold-path/epilogue split points, turning local jumps into stack-leaking tail dispatches; a pre-discovery coalesce pass folds the fragments back. -->
# xbox-recomp-config-function-list-splits-leak-guest-stack

**Technique:** Two converging stack-balance instruments (ABI callee-saved check + per-call-site esp/ebp delta) localized the leak class; capstone disasm of the flagged targets showed they were mid-function fragments; fix is a graph pass, not per-site.

## Notes

## Context

OG-Xbox static recompiler SDK (`D:\My apps\og-xbox-recomp-sdk`, `c` branch),
Part 2 runtime bring-up of X-Men Legends. The recompiler is driven by
`configs/xmen-legends-functions.toml` — 27,673 `"0xSTART" = { end = 0xEND }`
pairs generated from the X-Men disassembler's `functions.json`.

## Symptom

Recompiled game hung ~962 guest calls in, deep in MSVC C++ static init.
Spin stack: `... sub_001A3554 -> sub_000CC200 -> ... -> sub_001186A0`
(infinite loop in a container/tree walk on a garbage pointer).

## Investigation

Built two independent instruments, compiled under `-DREX_TRACE`:

1. **ABI callee-saved check** (in `rex_dispatch`): snapshot ebx/esi/edi/ebp
   before an indirect call, compare after, report per-target.
2. **`rex_call_balance(site, target, sp0, sp1, bp0, bp1)`** emitted at every
   *direct* call: flags a callee that returned with esp outside `[sp0, sp0+64]`
   (a plausible `ret N`) or that changed ebp.

Both had to fully exempt `_SEH_prolog4` (0x3432A8) and `_SEH_epilog4`
(0x3432E3): the prolog deliberately returns with esp *below* the call site
(it did `sub esp, localsize`), the epilog deliberately returns *above* it
(it tore the frame down). Flagging them buried the real signal.

After that exemption the balance instrument flagged a handful of functions
leaving esp hundreds to thousands of bytes low: `sub_001A237D` (-3100),
`sub_001A3211` (-736), `sub_0019EB69` (-744). The ABI check independently
flagged `icall` targets `0x342BFC`, `0x349FAB`, `0x3418DA` not restoring
esi/ebx.

Capstone disasm of the flagged addresses against the flat image
(`recomp_image.bin`, `.text` at `file_off = va - 0x11000`):

- `0x00342BFC` = `mov eax,[ebp+8]; pop esi; pop edi; leave; ret` — a bare
  **shared function epilogue**, no prologue. Not a function.
- `0x003418DA` = `mov [ebp-0x20],1; or [ebp-4],-1; call ...; call _SEH_epilog4;
  ret 0x14` — the **cold tail** of `sub_003418AF`, reached by its `jge 0x3418DA`.
- `sub_001A237D` really is `[0x1A237D, 0x1A23F3)`: `push ebp; mov ebp,esp;
  sub esp,0xC00; ...; jz 0x1A23D9; <hot path> ret 0xC`. The X-Men list splits
  it into THREE entries: `0x1A237D` (end `0x1A23D9`), `0x1A23D9` (end
  `0x1A23E2`), `0x1A23E2` (end `0x1A23F3`).

## Root cause

The disassembler's list contains **basic-block / cold-path split points, not
just function entries.** The recompiler's discovery clips a config function's
blocks at its declared `end`, so:

- a local `jz cold_path` that sits *past* the hot-path `ret` becomes a
  **tail dispatch** (`if (zf) { rex_dispatch(cold); return; }`) that returns
  from the function **without unwinding `sub esp, N`** — leaking N bytes of
  guest stack per call;
- a fragment with no terminator (e.g. `push 4; call [x]; pop ecx`) falls off
  the end of its generated C function = an implicit `return`, same leak.

Accumulated across the `_initterm` constructor loop in `sub_001A3554`
(~325 ctor calls) plus a clobbered loop-cursor register (`esi`), the loop
walked its ctor table off the end and called into garbage → the observed hang.

## Fix

`phase_coalesce` — a new pass that runs immediately after `phase_register`,
while nodes are still `ST_REGISTERED` (base + size only, no blocks yet). For
each config node A it finds the next config fragment B starting at, or a few
bytes past, `A.end` (the gap is a mis-attributed orphan instruction), and folds
B into A (`A.size = B.end - A.base; fg_remove(B)`) when **both**:

- B does not open with a real MSVC prologue (`push ebp` / `sub esp,` /
  `mov edi, edi` hot-patch pad / `enter`); and
- A branches into B — a conditional `jcc` to `B.base`, an unconditional short
  `jmp` to `B.base` a handful of bytes past A's end, or (once A has already
  absorbed one fragment) a clean fall-through with no `ret`/`jmp`/`int3` as its
  last instruction.

Iterates (max 8 passes) to collapse 3+-way splits. Pure graph edit before
discovery, so the normal block walker then covers the whole real function and
the local jumps stay `goto`s.

## Result

X-Men Legends: **6,579 fragments folded**, emitted function count
33,678 → 26,765 (≈ the authoritative count — the inflation *was* the
fragments), guest execution **962 → ~12,600 calls**. The SEH/stack-leak wall
is gone; the next wall is a genuine C++ static-init-order problem (uninitialised
Alchemy singleton globals at `0x5bc51c` etc., `sub_00216210`).

Commits `e21e5ab`, `118bcdd` on the `c` branch of `og-xbox-recomp-sdk`.

## Transfer

The sibling Python-pipeline recomp (`D:\My Games\Xbox Recomp`) has the **same
class unfixed** — `depth_audit.py` there named `sub_00200AD0` / `sub_00200BE0`
leaking 4 bytes each ("named, not fixed"), and its own notes describe
`sub_00200AD0` as "either falls through to its own epilogue or tail-calls
`sub_00200B18`, a continuation". Same split-continuation shape. A coalesce
pass in that pipeline's graph stage would likely clear it too.

## Lesson

An "authoritative function list" from a disassembler is not necessarily a list
of *function entry points* — it may include jump-table targets, cold paths and
shared epilogues as separate entries. A recompiler that clips discovery at each
listed `end` will silently truncate real functions. Detect and re-merge the
fragments before lowering; the tell is a same-function forward branch across a
listed boundary combined with a fragment that has no prologue.
