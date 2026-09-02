<!-- summary: Signature databases and SDK headers are worth far more combined than separately… -->
# Console SDK coverage in Ghidra

## Signature databases and SDK headers are worth far more combined than separately: one supplies which function an address is, the other supplies its prototype, and only together do they change what the decompiler produces.

Applies to any console or platform Ghidra does not ship support for. Worked through on Xbox; the shape is the same for others.

## Three separate gaps, none of which implies the others

1. **A loader.** Without it Ghidra cannot import the executable format at all.
   An already-imported program still OPENS anywhere, because the format is
   recorded in the database - so a machine can appear to support a format it
   cannot actually import. Test by importing a fresh file, not by opening an
   existing project.
2. **Symbol identification.** A signature database matches library code by byte
   pattern and gives addresses names.
3. **Types.** Ghidra ships archives for win32 and a few others and nothing for
   console SDKs, so every platform call decompiles as `undefined4 param_1`.

## Loader extensions are version-pinned, and fail silently

A Ghidra extension declares `version=` in `extension.properties`. If it does not
match the installed Ghidra exactly, the extension is ignored - **with no error
message anywhere**. It simply does not appear, which reads as "this Ghidra does
not support that format".

Editing that one line is enough when the APIs the extension uses have not
changed across the versions in question, and it is worth trying before hunting
for a rebuild. Confirm it took by importing headless and looking for the loader
name in the log:

    INFO  Using Loader: <format> (ProgramLoader)

## Parsing SDK headers: preprocess first

Ghidra's C parser is not a full preprocessor. Handing it real SDK headers means
fighting include paths, macros and conditionals for nothing. Flatten first:

    gcc -o flat.h -x c -P -E -Iinclude all_headers.cpp

Two things that look like problems and are not:

- **The flattened file will not compile.** `__stdcall`, `__fastcall` and
  `__declspec` are MSVC keywords GCC rejects in those positions. Irrelevant -
  Ghidra's parser understands them, and they are precisely what carries calling
  convention into the database. Do not "fix" them out.
- Many projects ship a Makefile that already produces exactly this flat file for
  their own purposes. Look before writing one.

Parse with `CParserUtils.parseHeaderFiles`. Two overloads matter: one writes a
reusable `.gdt` archive, one parses into a program's own DataTypeManager. Do
both - a `.gdt` alone changes nothing for the decompiler until the types are in
the program.

## The join is where the value is

A name without a signature still decompiles as `undefined4 param_1`. A signature
with no address has nothing to attach to. Neither step alone is worth much, which
is why doing one and stopping feels like a let-down.

Join them by stripping the library prefix a signature database adds
(`D3D8__D3DDevice_SetRenderState_Simple` -> `D3DDevice_SetRenderState_Simple`),
looking that up as a `FunctionDefinition` in the DataTypeManager, and applying it
with `ApplyFunctionSignatureCmd`:

    undefined4 FUN_0035d900(undefined4 param_1, undefined4 param_2)
    void __fastcall D3D8__D3DDevice_SetRenderState_Simple(DWORD Method, DWORD Value)

Expect a substantial miss rate and do not treat it as failure. Measured on one
title: 142 of 344 applied, 67 were data symbols with no function, and 129 were
internal SDK functions that no public header declares. Only the publicly
declared subset can ever get a prototype this way.

## Never overwrite a human's name with a signature match

A name someone chose carries reasoning a byte-pattern match does not. When a
function already has a non-default name, attach the library name as a secondary
label instead of replacing it. Re-running the import then stays safe, which
matters because you will re-run it.

## Check before generating

Running a signature database against a project someone already processed
produced 338 of 344 "already present" and changed nothing. Query the current
state first; the interesting target may be a different program in the same
project - the second title there had never been processed and gained 365.

## An SDK of the wrong version names by code shape, never by vtable slot or field offset

When the exact SDK version a game shipped with is lost media, a nearby version is still worth a great deal - but only through the right channel. Measured on X-Men Legends (Alchemy ~3.0) against Alchemy 2.5 and 5.0.

**What does not transfer.**

- *Vtable slot numbers.* Slot 21 in the game is slot 19 in 2.5 for the same method, and the shift is not uniform: igNamedObject has 17 slots in 2.5 and 21 in the game, while igNode has 31 and 33. A base class gaining more slots than its derived class is a contradiction, which is the tell that no single offset exists.
- *Field offsets.* The same member sits at this+0x14 in 2.5 and this+0x10 in the game - the whole layout is skewed by one dword because the root object grew.
- *Header declaration order.* Alchemy declares 18 virtuals in igObject.h and 10 in igNode.h against real vtables of 31-33 slots, because most are generated by macros. Parsing headers for slot order finds nothing.

**What does transfer: the code.** The instruction sequence barely changes between versions. Fingerprint each function as a normalised token stream with displacements masked out (they are exactly what the versions disagree about), index rare n-grams to pull candidates, and score with a diff ratio so an inserted instruction does not break a match.

Two rules that carry the technique:

1. *Never bucket on exact equality.* First attempt keyed candidates on the whole normalised body and found 3 matches from 30,045 x 15,933. Two builds of nearby source are never identical. Rare-n-gram indexing plus fuzzy scoring took it to 394 candidates.
2. *Corroborate, do not threshold.* Require that the functions a match calls also match. Where the version gap breaks the call graph, a second SDK version is the substitute: when two independently built versions propose the same Class::method, that agreement is evidence that does not depend on the call graph at all. Adding a second version took corroborated matches from 29 to 71, and 27 of those came from cross-version agreement alone.

**Do not try to rescue shape collisions with offsets.** Masking displacements collapses whole families - every refcounted-object destructor is the same release block repeated, so 18 different classes' destructors matched one reference. Matching on the *deltas* between consecutive offsets looks like the fix, since a constant base skew cancels. It is not: scored against ground truth later supplied by the binary's own class registry, it was 5 right out of 16, and the score did not separate right from wrong (0.34 correct, 0.62 wrong). No threshold would have helped. Use the delta sequence only to *reject* a suspect match - it proved all 18 wrong - never to make one.

Final yield on a 17,900-function binary: 45 names from ~70,000 reference bodies across two SDK versions. Modest, because most of a game binary is the developer's own code that was never in any SDK. Worth doing, but expect the engine layer only, and look for an in-binary source before investing here.
