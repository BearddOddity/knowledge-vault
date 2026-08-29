<!-- summary: RTTI vtable walking names thousands at once and beats every other source combin… -->
# Naming a large game binary at scale

## RTTI vtable walking names thousands at once and beats every other source combined; cross-binary transfer between binaries named the same way is worth almost nothing.

Measured on X-Men Legends (Xbox, 14,824 functions, 714 named at the start).
Sources are listed by what each actually returned, because the ordering was not
what was expected going in.

## What each source produced

| source | new names | notes |
|---|---|---|
| **RTTI vtable walk** | **3,748** | by far the largest |
| Signature database (XbSymbolDatabase) | 0 | already applied by earlier work |
| SDK header prototypes | 142 signatures | types, not names |
| Cross-binary transfer from a sequel | 81 | |
| Cross-binary transfer from 2 other titles | **4** | see the ceiling below |

Named functions went 714 -> 4,560, and the RTTI walk also DISCOVERED 2,484
functions analysis had never found - vtable targets never recognised as code.

## RTTI is the thing to do first

If the binary is C++ from MSVC, RTTI is present and the layout is fixed:

    TypeDescriptor            +0x00 vftable, +0x04 spare, +0x08 ".?AVFoo@@"
    RTTICompleteObjectLocator +0x00 signature(0), +0x0C TypeDescriptor*
    vtable                    the COL pointer sits at vtable[-1]

Find the name string, step back 8 to the descriptor, find what points at it,
step back 0x0C to a candidate locator, find what points at THAT, and the next
dword begins the vtable. Ghidra's own RTTI analyzer only runs on PE, so on any
other container - XBE here - it never fires and the data sits unused.

**Index once.** The first implementation scanned memory to answer "what points
at this address", once per class and again per locator. With ~900 classes that
is quadratic and produced nothing in two minutes. One pass building a map of
every 4-byte-aligned dword whose value lands inside the image makes each lookup
constant time and the walk finishes in about a minute. Only pointer-valued
dwords need indexing, so the map stays small - 51k entries, not millions.

**Do not invent demangled names for templates.** Reversing on '@' works for a
plain class and corrupts a template: ".?AV?$handle_str@...@ratl@@" became
"$0A::V?$handle_str::?$map_vs", which looks demangled and is wrong. 52 of 266
classes were affected. A wrong-but-plausible name is worse than an ugly one
because everything downstream trusts it and it is indistinguishable from a real
result. Keep templates in a sanitised raw form. Also make the re-run condition
accept the earlier bad pattern, or the fix will skip them for no longer being
FUN_.

## The transfer ceiling, which is the real lesson

Two other titles on the same engine, carrying 8,533 and 6,384 RTTI-derived
names, contributed **4** names. Diagnosed rather than guessed - of 10,433
unnamed hash groups in the target:

    no counterpart in either donor        4,146
    counterpart exists but ALSO unnamed   6,277   <- the ceiling
    named donor but ambiguous                 9
    usable                                    1

Both sides had been named by walking RTTI vtables, so both are blind in exactly
the same place: **non-virtual functions**. Transfer between binaries named by
the same technique cannot help, by construction.

**So do not acquire more binaries hoping for names.** They sharpen
classification and add nothing to naming. Breaking through needs a source that
reaches non-virtual code: diagnostic string cross-references (a function
referencing "FileMgr::Save open failure %s" IS FileMgr::Save), call-graph
propagation from named callers, or the engine's own type-registration table,
which names constructors and factories.

## Transfer rules that avoid poisoning the database

Carry a name only when the hash matches exactly one function on each side. A
one-to-many match cannot say which candidate owns the name. Never overwrite an
existing non-default name - a name a person chose carries reasoning a hash match
does not.
