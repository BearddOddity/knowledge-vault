# rexglue-sdk

## ## What ReXGlue is

## What ReXGlue is

`D:\My apps\rexglue-sdk-0.10.0` (v0.10.0, "early development"). A static
recompiler that converts **Xbox 360 PowerPC** XEX code into portable C++ that
runs natively (Windows/Linux, amd64/arm64). Ahead-of-time C++ generation, not
interpret/JIT. Lineage: Xenia (360 emulator, kernel + GPU), XenonRecomp
(codegen analysis + instruction translations), rexdex's recompiler.
BSD-3-Clause. GitHub `rexglue/rexglue-sdk`.

**Relevance to the X-Men Legends Xbox (original, x86) recomp:** different ISA,
but it is a mature, well-factored implementation of the exact pipeline that
project hand-rolls, and it has solved that project's two chronic problems
(register-ABI fidelity and function discovery). Study it as a reference design,
not as reusable code.

## Register / ABI model — the big lesson

Every recompiled function is `void f(PPCContext& __restrict ctx, uint8_t* base)`
— a **context struct passed by reference** plus a memory base pointer. Registers
(`r3..r10`, `f1..f13`, `XER{so,ov,ca}`, per-field `CR`) are **struct members**,
never globals.

Contrast the X-Men recomp: it uses **global** `g_eax`/`g_esp`/`g_ebx`... . That
single choice is the root of most of its ledger — callee-saved clobbers (#38,
#52, #81, #145, #151, #173, #186, #267), the whole `_icall_esp` class, esp
drift (#198). With a per-call context struct the C++ compiler enforces the ABI
for free and re-entrancy/threading is automatic.

Host<->guest calls are **template metaprogramming**, not hand-written register
juggling: `ArgTranslator` marshals args by ordinal (int in r3-r10 then stack at
`r1+0x54+8*(n-8)`, float in f1-f13); `HostToGuestFunction<Func>` /
`GuestToHostFunction<T>(func, args...)` wrap a normal C++ signature. A host
shim just declares `HRESULT Foo(uint32_t a, MappedPtr<Bar> b)` and the template
does the rest. `GuestToHostFunction` builds a fresh `PPCContext`, subtracts the
PPC64 min frame from `r1`, translates, calls, translates the return.

## Flags — computed eagerly, no "deferred flag" class

PPC's model is explicit (CR fields, XER.CA), and ReXGlue emits the flag
computation **inline at the defining instruction**: `addc` writes
`xer.ca = a+b < a;` right there; `subfe` writes its `.ca` immediately. There is
no "a compare set a flag N instructions ago, consumed later" problem.

The X-Men recomp's deferred-flag bug class (#160 neg/sbb, #256, #274
sub_001EB890's `cmp;jne;...;sbb eax,eax`) exists because x86 EFLAGS are
implicit and its lifter computes them lazily/inconsistently into a `_cf` var.
Lesson: compute every x86 flag eagerly into a struct/local at the instruction
that defines it — uniformly, the way ReXGlue does for CA/CR.

## Analysis — a 7-stage fixed-point graph (`rex::codegen`)

`Analyze()` builds a `FunctionGraph` through named phases (`phases.h`,
`phase_*.cpp`):

1. **Register** — seed from PDATA (`IMAGE_CE_RUNTIME_FUNCTION` exception
   directory: BeginAddress + Prolog/Function length bitfield), CONFIG (author
   TOML assertions the binary cannot make for itself), `__save/__restgprlr`
   helpers, import thunks.
2. **Scan** — segment sections into code/data regions on null-word boundaries;
   stop at the export table.
3. **Discover** — worklist **block-based** recursive discovery. Linear sweep to
   a terminator (blr/bctr/uncond b); follow both edges of a conditional;
   `projectedSize` caps a fall-through block at the branch target so it cannot
   swallow unrelated code; jump-table detection at every `bctr` (4 patterns:
   ABSOLUTE `lwzx`, COMPUTED `lbzx+rlwinm`, BYTEOFFSET `lbzx+add`, SHORTOFFSET
   `lhzx+add`). Iterates to a fixed point.
4. **VTable** — RTTI walk: find Complete Object Locators in `.rdata`, the vtable
   sits at `vtable[-1]`, read slots until a non-executable address, demangle
   `.?AV...` names. (Same technique the X-Men project uses.)
5. **GapFill** — find code regions no function covers, split them on terminators
   (blr / tail calls), register the pieces as functions. **This phase is the
   X-Men recomp's single biggest recurring defect** ("a function whose only
   reference is a pointer in a table is never reached") turned into a routine
   pipeline step.
6. **Merge** — "vacancy-based function expansion and sealing"; iterative jump
   resolution to a fixed point (`max_resolve_iterations` cvar).
7. **Validate** — assert **every** call/tail-call target resolves; report
   config-boundary contradictions (non-fatal but surfaced, so a no-op rebuild
   is explainable).

Support: `SigScanner` (dword pattern+mask, wildcard bits, for helper stubs and
future HLE memset/memmove), `FunctionAuthority`/`TargetKind` provenance,
discontinuous-function "chunks" with explicit parent, `FunctionScanner`
prologue/epilogue/`__restgprlr` pattern matching.

## Indirect calls — no "failed icall"

`resources/templates/codegen/_indirect_call.inja`. `REX_CALL_INDIRECT_FUNC(x)`:
a dense per-module dispatch table lives at `IMAGE_BASE + IMAGE_SIZE`, indexed
`(target - CODE_BASE) * 2` over the whole code range plus a thunk reserve. Fast
path: bounds-check then index. Slow path (out of range, or in-range but
unregistered): `rex::runtime::ResolveIndirectFunction()` -> a global
`FunctionDispatcher` across every loaded module. Every target resolves to
*something*; there is no silent `g_esp += 4; eax = 0` corruption path like the
X-Men recomp's `RECOMP_ICALL` fallback.

`bctrl` emits `ctx.lr = <ret>; REX_CALL_INDIRECT_FUNC(ctr.u32); return;`.

## Codegen output

Templated via **inja** (`template_registry`, `resources/templates/codegen/*.inja`
- `funcs_h`, `init_cpp`, `register_cpp`, `module_registry_cpp`, `sources_cmake`,
`pch_h`). Config is **TOML** (`tomlplusplus`). One `PPCFuncMapping{guest, host}`
table. Per-instruction builders in `src/codegen/builders/` (arithmetic,
comparison, control_flow, floating_point, logical, memory, vector, system).
`ppc_trap(ctx, base, type)` for PPC `tw`/`twi` assertion traps.

## Runtime (`src/` + `include/rex/`)

Full Xenia-derived stack, far beyond a "shim": `kernel/` (xboxkrnl / xam / xbdm
modules with export-group `.inc` tables, CRT heap `o1heap`), `graphics/`
(**both** D3D12 and Vulkan command processors, Xenos register file, DXBC+SPIRV
shader translators, texture/RT caches), `audio/` (XMA decoder + register file),
`filesystem/` (STFS containers, disc-image + host-path VFS devices), `input/`
(SDL/XInput/MnK), `ui/` (ImGui, achievements overlay), `system/` (object table,
XEX2 module loader, LZX decompress, MMIO handler, export resolver).

`tools/binutils/` ships a full `powerpc-none-elf-*` binutils (as/ld/objdump/nm)
for assembling test fixtures. `tests/ppc/` has per-instruction fixture tests.

## Takeaways for the X-Men Xbox recomp

1. **Move the register file into a per-call context struct.** Biggest single
   win — deletes the callee-save / esp-drift / icall-esp bug family the ledger
   is dominated by. Large change; the payoff is structural.
2. **Make GapFill and Validate real phases** with a fixed-point loop, instead
   of one-off `find_missing_functions.py` / `seed_missing_functions.py` sweeps.
3. **Compute x86 flags eagerly and uniformly** at the defining instruction.
4. **Dispatch every indirect call through a dense table with a resolver
   fallback** - never a silently-corrupting no-op.
5. Signature-scan CRT/helper stubs (`__savegprlr` analogue: the x86
   `__SEH_prolog`/`__alloca_probe`/CRT-init thunks) instead of hand-seeding.
