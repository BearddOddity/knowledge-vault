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

## ## The runtime half — blueprint for a wider OG Xbox recomp…

## The runtime half — blueprint for a wider OG Xbox recomp SDK

Read of `include/rex/runtime.h`, `rex_app.h`, `system/` (kernel_state,
kernel_module, function_dispatcher, export_resolver, interfaces/*),
`kernel/xboxkrnl/`, `filesystem/`, `system/util/object_table.h`. ReXGlue's
runtime is a full Xenia-derived console layer, not a shim pile. The
*architecture* is what a reusable "OG Xbox recomp SDK" runtime should copy;
only the ISA/GPU/kernel *contents* differ. 360 term -> OG Xbox equivalent noted
throughout.

### Top level — `Runtime` + dependency injection

`Runtime` owns, as `unique_ptr`s: `Memory`, `FunctionDispatcher`,
`VirtualFileSystem`, `KernelState`, `IGraphicsSystem`, `IAudioSystem`,
`IInputSystem`, `ExportResolver`. Global `Runtime::instance()` after `Setup()`.

**`RuntimeConfig`** is pure DI — the caller supplies backends as factories, so
the runtime library never links a concrete D3D/SDL/Vulkan:
```
struct RuntimeConfig {
  unique_ptr<IGraphicsSystem> graphics;         // or a gpu_plugin string
  function<unique_ptr<IAudioSystem>(FunctionDispatcher*)> audio_factory;
  function<unique_ptr<IInputSystem>(bool tool_mode)>       input_factory;
  function<void(Runtime*, KernelState*)>                    kernel_init;
  bool tool_mode;   // true -> skip GPU, for analysis tools
};
```
Macros `REX_GRAPHICS_BACKEND(T)` / `REX_AUDIO_BACKEND(T)` / `REX_INPUT_BACKEND`
just wrap the factory lambdas. `tool_mode` lets the same runtime power a
headless CLI analyzer.

Setup order: `Setup(image_info, config)` -> `InitializeFunctionTable` ->
`SetupVfs` (mount `game_data_root` as `game:` / `d:`, `update_data_root` as
`update:`) -> kernel -> graphics -> audio -> input -> `LoadXexImage` ->
`PrepareModuleLaunch` (suspended main thread) -> hooks -> `Resume`.
**OG Xbox:** `LoadXexImage` -> load XBE; `d:` mount is already how the OG title
sees the disc; add `T:`/`U:`/`Z:` for HDD partitions.

### `ReXApp` — per-title customization without forking the SDK

Base class; `OnInitialize()` runs fixed phases (SetupEnvironment ->
SetupPresentation -> OnFinalizePaths -> ConstructRuntime -> LaunchModule).
~20 protected virtual hooks a title subclass overrides selectively:
`OnPreSetup(RuntimeConfig&)`, `OnLoadXexImage`, `OnPostLoadXexImage` (data
patches, achievements), `OnPreLaunchModule` (last-chance guest memory/code
patch), `OnPostLaunchModule(XThread*)` (attach monitors — thread is suspended),
`OnGuestThreadExit`, `OnConfigurePaths`, `OnConfigureFonts/Style`,
`OnCreateImmediateDrawer` ("bring your own renderer" — SDK runs with
`graphics == nullptr` and the app presents the guest itself).
`REX_DEFINE_APP(name, Create)` in main.cpp. **This is the model for
per-game overrides** — the X-Men recomp's `recomp_manual.c` hand-patches and
`main.c` boot-flag pokes become typed hook overrides.

### `FunctionDispatcher` — the icall / cross-module core

- Per-module **dense function table** at `IMAGE_BASE + IMAGE_SIZE`, sized to
  the whole code range; `SetFunction(guest_addr, PPCFunc*)` fills it,
  `GetFunction(guest_addr)` reads it. `InitializeFunctionTable(code_base,
  code_size, image_base, image_size, is_entrypoint)`.
- `kThunkReserveSize = 0x10000` per module for dynamically-allocated thunks
  (`AllocateThunk(func, caller_address)` — `caller_address==0` = host-initiated,
  routes to the entrypoint pool).
- `Execute` / `ExecuteInterrupt` / `ExecuteTrap` — the last mirrors the 360
  kernel's trap-frame APC delivery: run guest code on a thread already running
  guest code, then restore its full register state.
- `RegisterModule(id, code_base, RegisterFn)` / `UnregisterModule` for
  hot-loadable generated DLLs, with per-(caller,ordinal) thunk-cache
  invalidation on unload.
- `FindCallerModuleBase(addr)` -> which module owns an address.

**OG Xbox:** replace the icall fallback that the X-Men recomp hand-rolls
(`RECOMP_ICALL` doing `g_esp += 4; eax = 0`) with exactly this: a dense
`func_table[(addr - CODE_BASE)]` + a resolver for out-of-range / unregistered.

### `ExportResolver` — HLE kernel exports

- `Export{ uint16 ordinal; Type{Function,Variable}; char name[96]; uint32 tags }`.
  Tags: `kImplemented / kStub / kSketchy / kHighFrequency / kImportant /
  kBlocking / kLog / kLogResult`, plus an `ExportCategory` (Audio, FileSystem,
  Input, Memory, Threading, Video, ...). Packed tag word carries category in
  bits 16-23.
- Per-module tables (`ExportResolver::Table{module_name, exports_by_ordinal,
  exports_by_name}`), declared in `module_export_groups.inc` via
  `XE_MODULE_EXPORT_GROUP(xboxkrnl, Threading)` etc. — one `.inc`, included
  many times with different macro definitions to build the ordinal table, the
  name table, the registration calls.
- `GetExportByOrdinal(module, ordinal)`, `SetVariableMapping` (writes a guest
  address for an imported *variable*).

**OG Xbox:** the module set is different — `xboxkrnl.exe` ordinals (there is
one canonical ordinal->name list), plus `d3d8.dll`, `dsound.dll`, `xapilib`,
`xonline`. The `.inc`-multi-include table-builder trick transfers verbatim.

### HLE export implementation pattern

Each kernel function is a **plain C++ function with a natural signature**, using
guest-pointer smart types:
```
u32 ExCreateThread_entry(mapped_u32 handle_ptr, u32 stack_size,
                         mapped_u32 thread_id_ptr, u32 xapi_thread_startup,
                         mapped_void start_address, mapped_void start_context,
                         u32 creation_flags) { ... return X_STATUS; }
REX_EXPORT(__imp__ExCreateThread, ...::ExCreateThread_entry)
```
`mapped_u32` / `mapped_void` carry both a host pointer and `.guest_address()`.
`REX_EXPORT` runs the `HostToGuestFunction<Func>` template (see the earlier
note): it reads args from the guest context by ABI ordinal, calls the C++
function, writes the return to the return register. A stub is just a function
that logs and returns a plausible `X_STATUS`. `REXKRNL_IMPORT_TRACE` /
`_IMPORT_RESULT` for per-call logging gated on the tag.

**OG Xbox:** identical shape, x86 `__stdcall`/`__cdecl` arg marshalling instead
of PPC r3-r10. The X-Men recomp already does this by hand per shim; the
template + `.inc` table generalizes it.

### `KernelState` + `ObjectTable` + `XObject`

- `KernelState` holds: `memory()`, `object_table()`, title process / system
  process, executable module, TLS layout.
- `ObjectTable`: `AddHandle(XObject*, X_HANDLE*)`, `Duplicate/Retain/Release/
  RemoveHandle`, `GetObjectByName`, `LookupObject<T>(handle)` (type-checked via
  `T::kObjectType`), `Save`/`Restore` (savestates). Refcounted `object_ref<T>`.
- `XObject` subclasses: `XThread, XEvent, XMutant, XSemaphore, XTimer, XFile,
  XModule, XSymbolicLink, XNotifyListener, XSocket, XIoCompletion, ...` — each a
  guest handle + optional named registry entry + guest-side dispatcher-header
  object.

**OG Xbox:** same object model — `Nt*`/`Ke*`/`Ob*` create/wait/close, dispatcher
objects, `OBJECT_ATTRIBUTES` with a name. Fewer objects (no XAM), plus the OG
`Ke`-level APIs the 360 hid.

### `VirtualFileSystem` — device model

`VFS` = list of `Device`s (each `mount_path` like `game:`, `d:`, `hdd:`) +
symlink map. `Device` virtual interface: `Initialize`, `ResolvePath`,
`is_read_only`, allocation-unit / sector geometry (for `NtQueryVolumeInfo`).
Concrete devices: `DiscImageDevice` (XISO), `HostPathDevice` (a host dir),
`StfsContainerDevice` (360 STFS), `NullDevice`. `OpenFile(root, path,
disposition, access, ...)` -> `File*`.

**OG Xbox:** drop STFS. Add a **FATX device** (for HDD partition images) and
keep the XISO (`DiscImageDevice`) and `HostPathDevice`. Mount `D:` = disc,
`T:`/`U:`/`Z:` = HDD, `Y:` = dashboard. FATX has 42-char names, `-` allowed,
specific attribute bits.

### `IGraphicsSystem` — the GPU seam

Two-call setup: `SetupPresentation(app_context)` (build provider + swapchain +
ImGui) then `SetupGuestGpu(function_dispatcher, kernel_state)` (wire MMIO,
command processor, vsync worker into guest address space). Guest-facing hooks:
`SetInterruptCallback(cb, user_data)`, `InitializeRingBuffer(ptr, size_log2)`,
`EnableReadPointerWriteBack`, `InitializeShaderStorage(cache_root, title_id)`.
Backends: D3D12 and Vulkan command processors, each translating the Xenos
register/packet stream and ucode shaders (DXBC + SPIRV translators).

**OG Xbox:** the seam is the same, the contents change a lot. OG Xbox is
**NV2A + a fixed-function-ish D3D8**. Two viable backends:
(a) HLE the D3D8 API surface (like the X-Men recomp's `d3d8_shim.c`) — translate
`IDirect3DDevice8` calls to D3D11/12 or Vulkan; much less work, no pushbuffer
interpreter.
(b) NV2A pushbuffer + register emulation (like nv2a in xemu) — faithful but
heavy, and Rule #11 of the X-Men project forbids it for that title.
The `IGraphicsSystem` interface accommodates either; `tool_mode`/headless and
"bring your own renderer" already exist.

### `IAudioSystem` / `IInputSystem`

Deliberately tiny: `Setup(KernelState*)` / `Shutdown`. Audio backend (SDL) owns
the mixer + an XMA decoder + XMA register file (context array the guest DMAs
to). Input backend owns SDL/XInput/MnK drivers merged into per-slot state.

**OG Xbox:** audio is DirectSound + optional XMA/ADPCM/WMA; input is the OG
gamepad (`XInputGetState` predecessor, `IDirectInput8` on some). Same seam.

### Memory model

`Memory` gives `virtual_membase()`; guest pointers are `GuestPtr<T>(base, addr)`
= `base + addr` reinterpreted, with mirrored views for the console's aliased
physical/virtual ranges and endian wrappers (`be<T>`). **OG Xbox is
little-endian** — no byte-swap layer needed, which removes a whole class of the
360 port's complexity. Physical RAM 64 MB (retail) / 128 MB (devkit), the
mirror-modulo arithmetic the X-Men recomp already models.

### What an "OG Xbox Recomp SDK" would be, concretely

Fork this layout:
- `codegen/` — swap the PPC lifter for the X-Men project's x86 lifter (its
  `tools.recomp`), keep the FunctionGraph / 6-phase analysis (see the deep-dive
  note — it is the fix for that project's discovery problems).
- `runtime/` — keep `Runtime` + DI + `FunctionDispatcher` + `ExportResolver` +
  `VFS` + `ObjectTable` + `KernelState` verbatim in shape; fill with OG Xbox
  `xboxkrnl` ordinals, a FATX device, a D3D8-HLE `IGraphicsSystem`, a
  DirectSound `IAudioSystem`, an OG-gamepad `IInputSystem`.
- `app/` — `ReXApp` equivalent; each recompiled title is a small subclass with
  hook overrides instead of a patched `recomp_manual.c`.
- Drop: byte-swap layer, STFS, XAM/XBLA, Xenos/ucode. Add: FATX, D3D8 surface,
  the OG dashboard `Y:` mount.

## ## Pipeline method comparison — this vs the X-Men recomp Py…

## Pipeline method comparison — this vs the X-Men recomp Python pipeline

Written up in the recomp repo: `docs/pipeline/00-comparison-rexglue.md`
(commit `512af84`). Read `tools/disasm` + `tools/func_id` + `tools/recomp`
against `src/codegen/`.

The five real divergences:

1. **Discovery is one-shot vs fixed-point.** The Python side runs 5 detection
   passes once (known addrs → `push ebp` prologues → CC-padding-after-`ret` →
   direct `call` targets → build), then `_find_function_end` once per
   candidate. A function reachable only from a newly-seeded function is not
   found until a human re-runs the whole `disasm → func_id → recomp` chain —
   that manual loop is the entire ledger. ReXGlue's `Discover` loops
   `while (count grew)`; seeding is what the loop does.
2. **Extent: `max_addr` high-water walk vs `projectedSize`.** `_find_function_end`
   extends `max_addr` to each forward cond-jump target and has a documented
   `+1` fudge (ledger #254: `sub_00340D86` truncated 36→24 bytes, coverage
   853→7). ReXGlue caps the *false* branch of a conditional at
   `target - fall_through` so it can't eat the jumped-to block; extent = union
   of discovered blocks.
3. **Unresolved target: silent `{ g_esp += 4; }` stub vs a build-time Validate
   gate.** The Python side discovers unresolved calls at runtime (failed-icall
   census, crash triage). ReXGlue asserts every edge resolves at build time and
   routes every icall through a dense table + resolver — no no-op path.
4. **Provenance derived vs intrinsic.** `func_id` classifies *after* discovery
   into a second JSON. ReXGlue sets `FunctionAuthority` at node creation and the
   whole merge/vacancy logic keys on the lattice.
5. **Global registers vs per-call `PPCContext&`.**

Ranked adoption list (in the doc): FunctionGraph + authority lattice >
`projectedSize` > null-word Scan phase > fixed-point discovery > tail-call
heuristic set > context struct.

## ## The port — `ogxbox` / OgXbox.Recomp SDK (C#/x86, 2026-09…

## The port — `ogxbox` / OgXbox.Recomp SDK (C#/x86, 2026-09-10)

The design above was ported to C#, retargeted from Xbox 360 / PowerPC to
original Xbox / 32-bit x86. Location: `D:\My apps\og-xbox-recomp-sdk` (own git
repo). This is the "wider OG Xbox recomp SDK" the runtime-blueprint section
anticipated, and it supersedes the X-Men project's Python `tools/graph`
prototype (which had only reached Phases 1-2). .NET 10, xUnit, iced-x86 for
decoding. ReXGlue is BSD-3-Clause; derived files carry an attribution header
and `LICENSE.rexglue` sits at the repo root.

### What got ported, and its C# home

| ReXGlue | C# | notes |
|---|---|---|
| `function_types.h` / `function_node` / `function_graph` | `FunctionTypes.cs`, `FunctionNode.cs`, `FunctionGraph.cs` | authority lattice, 3-state machine, reactive resolution, vacancy checks, funclet marking, `ClassifyTarget` — verbatim in shape. Base index is a binary-searched `SortedList` (the phases hammer `getFunctionContaining`). |
| `binary_view` / `decoded_binary` | `Binary/BinaryView.cs`, `Binary/Xbe.cs`, `Binary/DecodedBinary.cs` | XBE header + section table + kernel-thunk imports; `XboxKernelExports` has the 371-entry ordinal→name table. `DecodedBinary` decodes on demand via iced-x86 and caches. |
| `vtable_scanner` / `sig_scanner` | `Analysis/VtableScanner.cs`, `Analysis/SigScanner.cs` | RTTI scan is nearly unchanged (ReXGlue already assumed 32-bit MSVC RTTI); dropped the byte-swap and the PPC 4-byte vtable-slot alignment check. SigScanner is byte+wildcard, unaligned. |
| `function_scanner` `discoverBlocks` / `detectJumpTable` | `Analysis/FunctionScanner.cs` | worklist block discovery, iced flow-classification instead of PPC opcode dispatch. `jmp reg` / `jmp [mem]` replace `bcctr`. x86 jump-table detector covers three forms: `jmp [table+idx*4]` disp32, `jmp [reg+idx*4]` with `reg ← mov/lea`, and the `mov reg,[T2+idx*4]; add reg,T1; jmp reg` offset-from-base form. Bounds from a `cmp idx,N` behind the jump. |
| all 6 `phase_*.cpp` | `Phases/Phases.cs` + `PhaseHelpers.cs` + `AnalysisErrors.cs` | Register / Scan / Discover / GapFill / Merge / Validate + `AnalysisPipeline.Run`. |
| `instruction_dispatch` + `builders/` | `Emit/CEmitter.cs` + `COperand.cs` | **full x86 rewrite** — see below. |
| `codegen_writer` | `Emit/CodegenWriter.cs` | partitioned `recomp_NNNN.c` + `recomp_decls.h` + dispatch table + weak import stubs. |
| runtime contract | `runtime/ogxbox_runtime.{h,c}` | per-call `RecompCtx*`, `MEM8/16/32`, eager-EFLAGS helpers, `rex_dispatch` (binary search), `rex_boot`. |

### x86 departures from ReXGlue

- **No `.pdata`.** 32-bit x86 has no `RUNTIME_FUNCTION` array — that entire
  Register-phase input is PPC/360-only. SEH is a runtime `fs:[0]` chain plus
  usually-stripped `FPO_DATA`. `PDATA` is kept in the authority lattice for
  shape parity only, unused. (Recorded as ledger #280 in the X-Men repo.)
- No PPC save/restore helpers (`__savegprlr` etc.) — the x86 analogues are
  `__SEH_prolog`/`__alloca_probe`/CRT-init thunks, sig-scanned; list still to
  be filled.
- `bcctr` → `jmp reg`/`jmp [mem]`; the 4 PPC jump-table patterns → the x86
  memory-operand and offset-from-base forms.
- x64 `_C_specific_handler` scope tables → x86 `_EH4` (`__except_handler4`);
  the GapFill `{handler, .rdata ptr}` skip keeps working with the `_EH4` shape.
- C++ EH `FuncInfo` magic `0x19930522` is identical on both.
- `PPCContext&` → `RecompCtx*`. The port took the per-call-context-struct
  decision from the start (the "biggest single win" from the takeaways above),
  so the whole global-register / `_icall_esp` / esp-drift bug family the X-Men
  Python recomp fought never exists here.

### The x86→C emitter (`Emit/CEmitter.cs`)

Per-mnemonic dispatch on iced's `Mnemonic`. **Eager EFLAGS** — every ALU op
emits its flag computation inline via `rex_flags_{add,sub,logic}` (the lesson
from ReXGlue's CA/CR handling, applied to x86). Operands render through
`COperand`: 32-bit regs are `RecompCtx` fields, `AL`/`AH`/`AX` go through
`LO8`/`HI8`/`LO16` + `SET_*` macros, memory operands become
`MEM{8,16,32}(base + index*scale + disp)`, `fs:`/`gs:` route through `rex_seg`.
Control flow: `jcc`/`setcc`/`cmovcc` from the eager flags, `jmp` internal →
`goto loc_X`, external → tail call, indirect → `rex_dispatch`; `call` by callee
name; `ret` → `return`. x87 is a circular `FPU_ST` stack with `rex_fcom` →
status word for `fnstsw`. REP string ops become `ECX`/`DF` loops. Unhandled
mnemonics emit a linked `REX_UNIMPLEMENTED` marker and are counted, never
silently dropped.

### Results on X-Men Legends `default.xbe` (Release)

- **Analysis:** 38,888 functions in ~5 s — 7,281 via direct calls, 3,424 via
  vtables, 28,052 gap-fill, 130 imports. 18,411 sealed, ~20k pending
  (unresolved jumps), 244 validation errors. The X-Men Python pipeline reached
  ~1,199 hand-seeded functions, so the fixed-point graph finds ~30x more with
  no manual seeding.
- **Emit:** 18,281 sealed functions, 912,354 instructions, **99.7% lowered to
  C**. The 2,953 unimplemented are `Iretd`, `In`/`Out` port I/O, obsolete BCD
  ops, and data decoded as code inside gap-fill regions.
- `ogxbox emit <xbe> -o <dir>` writes a complete linkable C tree
  (`recomp_NNNN.c`, `recomp_decls.h`, `recomp_dispatch.c`, `recomp_imports.c`,
  `ogxbox_runtime.{h,c}`) plus `functions.json` / `labels.json` /
  `seeded_functions.json` in the schema the X-Men `tools/recomp` already
  consumes.
- 43 xUnit tests. No C compiler was available in the build environment, so the
  emitted C is verified by unit tests on emitted-text patterns, not yet by
  compilation.

### Not yet ported (refinement, not codegen core)

`OgXbox.Recomp.Runtime` — guest RAM + XBE image load, kernel-import HLE
(override the weak `__imp__*` stubs), a `main()`; without it the generated C
links but does not run. Also: shrinking the ~20k pending (more jump-table
forms, `functionPointerScan` for `mov reg, imm32` code addresses, Merge vacancy
absorption), `RecompilerConfig` TOML loading, the multi-module
`ProjectRecompiler` driver, and compile-verification on a box with a C
compiler. Full file-by-file status: `PORTING.md` in the SDK repo.

## ## Port progress — config + runtime skeleton (2026-09-10, c…

## Port progress — config + runtime skeleton (2026-09-10, cont.)

Continued the C#/x86 port. SDK at `D:\My apps\og-xbox-recomp-sdk`, 13 commits.

**`config.cpp` → `Phases/RecompilerConfigLoader.cs`** (via Tomlyn 0.17 — the
2.x rewrite dropped the `Toml.ToModel` model API). Scalars, `[analysis]`,
`[functions] "0xADDR" = {size|end,name,parent,share_registers}`,
`[[switch_tables]]`, `[[midasm_hook]]`, `[[invalid_instructions]]`, top-level
`seeds`/`indirect_calls` arrays, recursive `includes` with cycle detection.
`Validate()` flags duplicate/conflicting/overlapping boundaries. x86 drops the
4-byte alignment checks, the PPC register local-var toggles, and the rexcrt
heap all-or-nothing group. **Gotcha:** `seeds`/`indirect_calls` are top-level
arrays and must precede any `[section]` in the file or TOML binds them to that
section. `ogxbox analyze|emit --config <file.toml>`.

**Merge second-chance resolution.** ReXGlue 0.10.0's `phase_merge.cpp` does not
actually call `absorbRegionIntoFunction` — it only does `tryResolveFunction` +
`markFuncletRegisterSharing` + `sealAllReady`, so a branch into another
function's body stays unresolved and the node never seals. On x86 (unaligned,
28k of 38k functions are gap-fill) that leaves ~20k pending. The port adds a
pass: an unresolved branch whose target lands inside another registered
function is recorded as a tail call to that function (ReXGlue `classifyTarget`
case 4) so it stops blocking the seal. +483 sealed. The emitter lowers such a
`jmp` to `rex_dispatch(c, 0xTARGET)` rather than calling a non-existent
`sub_XXXXXXXX`.

**Runtime skeleton** (`runtime/*.c` + `Emit/ImageWriter.cs`). ReXGlue's
`system/` layer is a full Xenia-derived console stack; the port ships a minimal
version that makes the output link and (in principle) run:
- `ImageWriter` emits `recomp_image.bin` (XBE sections concatenated raw — no
  decompression, unlike XEX) + `recomp_image.c` (a `{va, file_off, size}` map +
  `rex_load_image` that maps each section to its VA). XBE parsing stays in C#.
- `ogxbox_runtime.c`: `rex_boot(image_path)` — alloc guest RAM sized to
  `base + image_size + slack`, map the image, binary-search the dispatch table
  for the entry VA, call it with a fresh `RecompCtx` (`esp = 0x7FFF0000`).
- `ogxbox_kernel.c`: starter xboxkrnl HLE overriding the weak `__imp__*` stubs
  — a bump pool allocator (`ExAllocatePool*`, `MmAllocateContiguousMemory`),
  `DbgPrint` (walks the guest format string), `KeBugCheck`/`HalReturnToFirmware`
  (halt), `RtlInit*String`. **Calling convention:** the emitter lowers
  `call __imp__X` to a bare `__imp__X(c)` with no pushed return address, so the
  HLE reads args from `[esp]`, `[esp+4]`, ... and pops `4*argc` for `__stdcall`;
  `__cdecl`/varargs leave the pop to the generated caller.
- `CodegenWriter` emits a `CMakeLists.txt` listing every source, so
  `ogxbox emit <xbe> -o <dir>` produces a `cmake`-buildable tree.

Still not compiled — no C compiler in the work environment. The kernel HLE is a
skeleton; a working port grows it into the object table / thread scheduler /
FATX VFS / D3D8-HLE / DirectSound layer (much of which already exists as C in
the X-Men repo). `PORTING.md` in the SDK has the current file-by-file status.

## ## Port compile-verified — recompiled X-Men Legends boots a…

## Port compile-verified — recompiled X-Men Legends boots and runs (2026-09-10, cont.)

The C#/x86 port (`D:\My apps\og-xbox-recomp-sdk`, 16 commits) now produces
output that a C compiler accepts and that executes.

**Toolchain (Windows):** clang-cl from LLVM 22 (`C:\Program Files\LLVM\bin`,
not on PATH) + VS 18 Community BuildTools MSVC 14.51.36231 + Windows SDK
10.0.26100. Set `INCLUDE = <MSVC>\include;<SDK>\Include\<ver>\{ucrt,shared,um}`
and `LIB = <MSVC>\lib\x64;<SDK>\Lib\<ver>\{ucrt,um}\x64`; then `clang-cl /c`
each `.c`, `clang-cl /Fe:recomp.exe *.obj`.

**Result on X-Men `default.xbe`:** `ogxbox emit` → 45 C files / ~19 MB → **0
compile errors** (166 s) → links to a 22 MB `recomp.exe` → **runs**. The guest
boots, runs its CRT + engine init, spawns its main thread via
`PsCreateSystemThreadEx`, and executes real game code on that thread until it
hits a null indirect call (an uninitialized vtable slot from incomplete HLE —
`rex_dispatch(0)` logs and returns, non-fatal). This is the same "boots, runs,
faults deep in game code" state the hand-rolled X-Men Python recomp took months
to reach — the generated code itself is sound.

**Two emitter bugs the compiler caught (both fixed):**
1. `goto` / `call` to an address with no emitted `loc_X:` label and no declared
   function (a jump into another function's body, a non-sealed call target).
   `CEmitter` now precomputes the exact set of emitted labels; anything outside
   it routes through `rex_dispatch(0xTARGET)` (loud fail if unmapped) instead of
   naming an undeclared symbol.
2. Guest RAM was sized to the image (~4 MB) so the first `push` (stack at a high
   VA) was an access violation. Now 64 MB (retail Xbox), `esp` at `0x03700000`.

**Kernel-thunk dispatch.** The guest calls `[thunk_va]` whose value is still
`0x80000000 | ordinal` (the loader maps sections raw and does not fix up the
thunk table, unlike the real kernel). `rex_dispatch` branches on bit 31 into a
generated `rex_kernel_dispatch(c, ordinal)` (`recomp_kthunks.c`) that switches
ordinal → `__imp__<Name>`.

**Starter kernel** (`runtime/ogxbox_kernel.c`, ~40 xboxkrnl functions):
bump-allocator pool + `RtlAllocateHeap`/`FreeHeap`/`ReAllocate`/`SizeHeap`,
`Ex/MmAllocate*`, `NtAllocateVirtualMemory` (honours a requested base);
`PsCreateSystemThreadEx` spawns a real Win32 thread with its own `RecompCtx` +
a 256 KB guest stack from the pool, pushes `StartContext`, calls
`rex_dispatch(StartRoutine)`; `NtCreateEvent`/`SetEvent`/`WaitForSingleObject`
as Win32 handle wrappers; `KeQueryPerformanceCounter`/`QuerySystemTime`/
`DelayExecutionThread`; `DbgPrint` (walks the guest string). Calling
convention: the emitter lowers `call __imp__X` to a bare `__imp__X(c)` with no
pushed return, so an HLE reads args from `[esp]`, `[esp+4]`, ... and pops
`4*argc` for `__stdcall`.

**What is left is not codegen.** Growing the kernel into a playable layer
(object table, dispatcher objects, FATX VFS, D3D8-HLE, DirectSound) is the bulk
of a working port and much of it exists as C in the X-Men repo. Also: shrink
the ~20k pending functions, fill the last 0.4 % of instructions, chase guest
faults. The `rex::codegen` port itself — analysis, emitter, config, a runtime
that assembles and runs the output — is complete. `PORTING.md` has the
file-by-file status.

## ## The C branch — a second full port, in C (2026-09-10)

## The C branch — a second full port, in C (2026-09-10)

The user meant "C" when they said "C#" for the OG_reXcompiler port. Rather than
discard the working C# tool, it was branched: `csharp` keeps it, and `c` is a
from-scratch C11 re-port of the same recompiler. `main` == `csharp`. Both push
to `github.com/BearddOddity/OG_reXcompiler`. The tool's implementation language
does not affect the output — ReXGlue is C++, XenonRecomp is C++, the recompiled
title is C regardless.

### C-branch stack

- **x86 decode:** Zydis (git submodule) instead of iced-x86. `ZydisDecoderDecodeFull`
  → a reduced `DecodedInsn` (flow class + target + text), address-cached.
  `db_decode_raw` exposes the full `ZydisDecodedInstruction` + operands for
  jump-table analysis and the emitter.
- **TOML:** tomlc99 (git submodule) instead of Tomlyn.
- **Build:** CMake + clang-cl (LLVM 22) + VS BuildTools. `git submodule update
  --init --recursive` first (Zydis pulls zycore).
- **C stand-ins for the BCL:** `util.h` — `VEC(T)` growable array macro,
  `u32map` open-addressing hash map/set, `strbuf`. **Gotcha that cost an hour:**
  `u32map_init` MUST round capacity up to a power of two or the `& (cap-1)`
  probe mask is wrong and lookups spin forever. This hung the whole pipeline
  until found.

### Port map (`c` file ← C# file)

`xbe.c` ← Xbe.cs · `kernel_exports.c` ← XboxKernelExports.cs (371 ordinals) ·
`binary_view.c` ← BinaryView.cs · `decoded.c` ← DecodedBinary.cs +
DecodedInstruction.cs · `func_types.h` ← FunctionTypes.cs · `func_graph.c` ←
FunctionNode.cs + FunctionGraph.cs · `scanners.c` ← VtableScanner.cs +
SigScanner.cs · `func_scanner.c` ← FunctionScanner.cs · `config.c` ←
RecompilerConfig{,Loader}.cs · `context.c` ← CodegenContext.cs +
AnalysisErrors.cs · `phases.c` ← Phases.cs + ScanPhase.cs + PhaseHelpers.cs ·
`emit_operand.c` ← COperand.cs · `emit.c` ← CEmitter.cs · `writers.c` ←
ImageWriter.cs + CodegenWriter.cs + GraphExporter.cs · `main.c` ← Program.cs.
`runtime/` is unchanged (already C).

### C translation notes

- `CallTarget` discriminated record → a tagged struct `{kind, node, address, name}`.
- C# `Dictionary`/`HashSet`/LINQ → explicit loops over `u32map` slots.
- Nested-function closures (`IsInternalTarget`, `Enqueue` inside
  `DiscoverBlocks`) → an explicit `DiscCtx` struct passed to file-scope helpers
  (clang has no nested functions).
- `VEC(T)` expands to a fresh anonymous struct type each use — two `VEC(Block)`
  are incompatible for assignment. Fix: `typedef VEC(Block) BlockVec;` for any
  vec that gets assigned or stored in a struct.
- Perf: added `unresolved_by_target` (target addr → list of node bases with an
  unresolved jump there) so `fg_notify_added` is O(matches) not O(functions);
  `sorted_bases` is kept incrementally sorted (binary-insert) instead of
  re-sorting on every add. Without these the fixed-point loop was O(f²)+.

### Verified

`ogxbox emit` on X-Men `default.xbe`: 28,266 functions analysed, 17,124
emitted, 888,874 instructions, **99.7% lowered**. The 43-file output compiles
with clang-cl at **0 errors** (~136 s), links, and **runs** — guest boots, runs
CRT init, calls `Nt*SymbolicLinkObject`, stops at the same NULL-StartRoutine
wall as the C# branch (XAPI init HLE still a stub).

### Delta from `csharp`

The C analysis finds ~28k functions vs the C#'s ~39k — its fixed-point
discovery ends a round earlier and a few jump-table forms are less aggressive.
Instruction-lowering coverage is the same. `BRANCHES.md` in the repo tracks it.
