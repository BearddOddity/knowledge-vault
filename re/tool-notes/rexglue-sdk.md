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

## ## Deep-dive: the analysis engine, algorithm by algorithm

## Deep-dive: the analysis engine, algorithm by algorithm

Read of `src/codegen/` (analyze, phase_*, function_scanner, function_graph,
vtable_scanner, sig_scanner, plus the data-model headers). This is the
implementation-level detail for reimplementing it (C, Python, or C#).

### Data model (`function_types.h`, `function_node.h`, `function_graph.h`)

**`FunctionAuthority`** — provenance, ordered by trust; only the lowest is
mutable:
`GAP_FILL(0)` absorbable < `DISCOVERED(1)` bl/bcl target < `VTABLE(2)` <
`HELPER(3)` save/restore < `PDATA(4)` .pdata entry < `CONFIG(5)` author TOML <
`IMPORT(6)`. `addFunction()` with a higher authority overwrites a lower one at
the same address.

**`FunctionState`** — 3-state machine, transitions gated:
`kRegistered` (entry known, no blocks) → `kDiscovered` (blocks + instructions
assigned, branches maybe unresolved) → `kSealed` (every branch resolved,
`FunctionAnalysis` computed, blocks sorted).
`canDiscover() = state==kRegistered`. `canSeal()` = `kDiscovered` && (import ||
(blocks non-empty && no unresolved jumps)).

**`FunctionNode`** carries: base/size/name, cached code ptr, authority, state,
`blocks[]` ({base,size}), `instructions[]` (pointers into a single
`DecodedBinary`), `labels` (set — internal branch targets), `calls[]` /
`tailCalls[]` (`CallEdge{site, CallTarget}`), `jumpTables[]`,
`unresolvedJumps[]` (`{site, target, isCall, isConditional}`), `exceptionInfo`
(variant: SEH or C++ EH), `sharesRegisters` (SEH-funclet flag).

**`CallTarget`** variant: `ToFunction{node}` / `ToImport{addr,name}` /
`Unresolved{addr}`. **`TargetKind`** for codegen: `InternalLabel` (PIC / target
inside caller), `Function`, `Import`, `Unknown`.

**`FunctionGraph`** indexes: `functions_` (addr→node, O(1)),
`functionsByBase_` (std::map, O(log n) interval lookup for "which function
contains addr"), `functionHasXrefs_`, `chunks_` (config address ranges),
`codeBuffers_` (owns copies of executable section bytes so codegen is
module-free), a `MemoryReader` callback for null-dword checks.

### The pipeline (`Analyze()`)

`initDecoded()` (decode every instruction once) → **Register → Scan → Discover
(+VTable) → GapFill → Merge → Validate**. Each phase is a free function taking
`CodegenContext&`.

### Phase 1 — Register (`phase_register.cpp`)

Seeds entry points from:
- **PDATA / exception directory**: `IMAGE_CE_RUNTIME_FUNCTION { u32 BeginAddress;
  union{ u32 Data; struct{ u32 PrologLength:8; FunctionLength:22; ThirtyTwoBit:1;
  ExceptionFlag:1; }}}`. Gives entry + a size hint (`FunctionLength`).
- **CONFIG**: author TOML — exact boundaries, immutable; assertions the binary
  cannot make for itself. A discovery result that carves an entry out of a
  declared CONFIG range is a (non-fatal) Validate warning.
- **`__save/__restgprlr` / `__save/__restfpr` / VMX** helpers via SigScanner.
- **Import thunks** from the import table → `IMPORT` authority, name `__imp__*`.

### Phase 2 — Scan (`phase_scan.cpp`)

Segments each section into code/data `CodeRegion{start,end}` on runs of null
words (`0x00000000` = inter-function padding boundary). Truncates the scan at
the export table. Regions bound later merges — a branch that crosses a region
boundary is forced to be a tail call, which stops "mega-merges".

### Phase 3 — Discover (`phase_discover.cpp` + `function_scanner.cpp`)

**Iterative to a fixed point** (`max_discovery_iterations`): each round,
`discoverPendingFunctions()` walks every `canDiscover()` node and runs
`discoverBlocks(entry)`; new `bl` targets found get added as `DISCOVERED`
functions, which makes more nodes pending; loop until the function count stops
growing.

`discoverBlocks(entry, region, knownFunctions, pdataSize)` — **worklist / DFS
block scanner**:
- Stack of `DiscoveredBlock{base, end, has_terminator, projectedSize,
  successors[]}`. `scannedAddrs` set prevents two blocks overlapping.
- Linear-sweep each block until a terminator. **Terminators**: `blr` (return),
  `bctr` (indirect — run jump-table detection, push all resolved targets),
  unconditional `b`/`ba`, a null word, hitting another known entry point,
  hitting an already-scanned address (emit a `goto` successor), an invalid
  address.
- **Conditional branch** (`bc`): ends the block; pushes true-case (target, no
  size limit) and false-case (fall-through). **The false-case gets
  `projectedSize = target - fall_through`** so the fall-through block cannot
  grow past the branch target and swallow unrelated code. Projection is
  *carried forward* across continuous internal branches
  (`carry = projectedSize - consumed`).
- **`bl` does NOT end a block** — it records an external call and continues.
- Conditional `blr` (`beqlr` etc.): ends block, pushes fall-through.

**Tail-call heuristics** for an unconditional `b target` (any one → tail call,
not internal):
1. `target` is in `knownFunctions`;
2. backward branch to an unknown target (`target < entry`);
3. forward branch > 1 MB (`target - addr > 0x100000`) — no real internal branch
   is that far;
4. `target` is a known callable (function or import);
5. `target` is in a different `CodeRegion` and not a configured chunk;
6. **`target` has a prologue pattern** (`mflr` / `mfspr lr` / `stwu r1,-X(r1)`).

Prologue = `mflr` or `mfspr r,8` or `stwu r1,-X(r1)`.
Epilogue = `blr` or `mtlr` or `lwz r1,0(r1)`.

`pdataSize > 0`: after normal CF discovery, sweep every 4 bytes of the declared
extent for `b`/`bc` instructions not in a discovered block — these are the
branches *inside SEH funclets* that normal flow misses; register their targets.

**Jump-table detection at `bctr`** (`detectJumpTable`) — 4 Xbox-360 compiler
patterns, matched by walking backward from the `bctr`:
- **ABSOLUTE**: `lwzx rD,rA,rB` — table holds full 32-bit target addresses.
- **COMPUTED**: `lbzx` + `rlwinm` (shift) + `add` — table holds a byte offset,
  shifted then added to a base.
- **BYTEOFFSET**: `lbzx` + `add` — byte offset added directly.
- **SHORTOFFSET**: `lhzx` + `add` — 16-bit offset added to a base.
Needs ≥ 2 resolved targets to accept. Also reads a bounds `cmplwi` for the case
count. Result: `JumpTable{bctrAddress, tableAddress, indexRegister, targets[]}`;
targets become internal labels.

**VTable scan** (`vtable_scanner.cpp`) — runs inside Discover, then a second
fixed-point discovery loop for the new functions:
1. Scan `.rdata` on 4-byte stride for a **Complete Object Locator**:
   `RTTICompleteObjectLocator{ u32 signature==0; offset; cdOffset;
   pTypeDescriptor; pClassHierarchy }` where `pTypeDescriptor+8` reads as a
   string starting `.?AV` or `.?AU`.
2. For each COL, scan `.rdata` for a dword == colAddr; the **vtable starts at
   that dword + 4** (COL sits at `vtable[-1]`).
3. `readVTableSlots`: read dwords until one is null, non-executable, or
   mis-aligned. Each slot is a `VTABLE`-authority function.
4. Class name = demangle `.?AVName@@` → `Name` (from `pTypeDescriptor+8`).

(Disabled: `functionPointerScan` — `lis`/`addi` and `lis`/`ori` pairs that build
a code address; "too many false positives". It skips targets within ±0x1000 of
the load as likely local labels.)

### Phase 4 — GapFill (`phase_gapfill.cpp`)

For each `CodeRegion`, `splitRegionOnTerminators`: walk 4 bytes at a time,
**split after every `blr` and every `b` whose target is a known callable**
(but not tail recursion to the segment's own start). Each resulting segment
whose start is not already an entry point and not inside another function gets
registered as a `GAP_FILL` function — **unless it `looksLikeExceptionData`**
(dword[0] is a known entry point AND dword[1] points into `.rdata` — the
`{handler, scopeTable}` shape). Then discover blocks for the gap functions, then
`cleanupAbsorbedGapFills`: drop any `GAP_FILL` that a higher-authority
function's blocks now contain, or that overlaps a lower-addressed `GAP_FILL`.

### Phase 5 — Merge (`phase_merge.cpp` + `function_graph.cpp`)

**Reactive resolution to a fixed point** (`max_resolve_iterations`): each round,
`tryResolveFunction(addr)` for every pending node walks its `unresolvedJumps`
and tries, in order: (a) **internal label** (`tryResolveAsInternalLabel` —
target within this function's bounds), (b) **function entry** (`getFunction`),
(c) **import**. A resolved jump becomes a `CallEdge` and is removed. Stop when a
round resolves nothing.

**Vacancy / absorption** — `isVacant(fromAddr, targetAddr)` is true iff: (1) no
null dword at `targetAddr`; (2) no chunk claims it; (3) `targetAddr` is not
inside a *protected* function — PDATA/CONFIG/HELPER always protect; a
`DISCOVERED`-with-xrefs entry is `isMergeableEntryPoint` and can be absorbed as
an internal label. Only `GAP_FILL` and mergeable-`DISCOVERED` regions get
absorbed.

`markFuncletRegisterSharing()`: flag every SEH funclet so its non-volatiles
stay in `ctx` (it must see what its owner left live) and callers sync their
localized register copies around the call.

`sealAllReady()` → `FunctionNode::seal()` computes `FunctionAnalysis`
(usesCtr/Xer/Cr/Fpscr, CSR requirement None/Fpu/Vmx for denormal handling) and
sorts blocks.

### Phase 6 — Validate (`phase_validate.cpp`)

Assert **every** `CallEdge` / tail-call resolves. `AnalysisErrors` categories:
`UnresolvedCall`, `MissingJumpTable`, `JumpTargetOutOfBounds`,
`DiscontinuousFunction`, `UnimplementedInsn` — grouped end-of-run report,
non-fatal. Reports config-boundary contradictions so a no-op rebuild is
explainable.

### `classifyTarget(target, callerAddr, isCall)` — codegen dispatch

Import → `Import`. Target == caller's own base → `Function` if `bl` (recursion),
`InternalLabel` if `b` (loop). Target is a different entry point → `Function`
(covers a thunk that falls through into another function). Target inside
caller's bounds → `InternalLabel`. Else `Unknown`.

### What to lift into the X-Men x86 recomp

- The **`FunctionAuthority` lattice + 3-state machine + reactive
  `FunctionGraph`** is the whole answer to "seeded functions regress / get lost
  / never found". Port it: PDATA→`RUNTIME_FUNCTION`, CONFIG→`seed_list.json`,
  vtable scan already exists, GapFill replaces `find_missing_functions.py`,
  Merge replaces the ad-hoc jump-table seeding, Validate replaces the
  failed-icall census.
- **`projectedSize` on fall-through blocks** — directly fixes the disasm
  `_find_function_end` truncation/over-run class (ledger #255, #170).
- **Split GapFill segments on `blr` + tail-call, skip `{handler,rdata}` data**
  — the x86 analogue is split on `ret`/`jmp <known>` and skip C scope tables.
- **The tail-call heuristic list** (>1 MB forward, backward-to-unknown,
  cross-region, has-prologue) maps almost 1:1 to x86.
- **Null-word region segmentation** the x86 recomp already half-relies on
  ("low memory reading zero is the invariant"); make it an explicit Scan phase.
