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

## The binary's own class registration table beats every external symbol source

Middleware that supports reflection registers every class at startup, and the registration call almost always passes the class name as a plain C string next to the class size. A stripped binary can therefore be carrying its own symbol table in .text, with no debug info, no PDB and no SDK.

Found in X-Men Legends (Intrinsic Alchemy). One registrar at 0x002235D0, 698 call sites, each a run-once flag then a block of `push imm32` and the call:

```
mov al,[flag]; test al,al; jnz          ; run once
push 0x255fc0        ; A - registerFields
push 0x27c080        ; B - deleting destructor wrapper
push 0xc8            ; SIZE - 200 bytes
push 0x405f40        ; NAME - "igBumpMapShader"
push 0x250870        ; C - own getClassMeta
push 0x19c140        ; D - parent accessor
push 0x281670        ; E - parent's registration block
push 0x5bdb0c        ; the class's _Meta global
call 0x2235d0
```

Yield: 696 classes named, 2,110 function pointers attributable to a class, 1,115 metaobject globals, and the true size of every class. 717 functions and 696 globals renamed in one pass.

**How to find it.** Do not go looking for the registrar directly. Pick one unnamed function you care about, walk its callers until you land on an address that is referenced from .text but is not inside any function - that is a `push` operand in a registration block. Read the other pushes; one of them will point at a printable identifier. Then take the `call` target at the end of that block and list its callers: that is the whole table.

**Establish each argument's role by reading one example, never by position.** Statistics across all sites tell you which slots are class-specific and which are shared, but only reading tells you what they are:

- a slot present at only some sites (429 of 698 here) distinguishes instantiable from abstract classes
- a slot unique per class is class-specific work (field registration, destructor)
- a slot with far fewer distinct values than sites (143 of 698) encodes the parent class

**A trap worth naming.** The parent slot that *looks* easiest to resolve may not be. Here slot D was a parent meta accessor, but matching it against the classes' own accessors resolved only 120 of 696 - all of them the root class - because a class has several accessors (getClassMeta, getClassTypeSafe, getClassTypeLazy) and D is not the same function as the parent's slot C. Slot E points *into* the parent's push block, so matching it against the call-site addresses resolved 695 of 696. When one resolution method gives a suspiciously lopsided answer, that is the signal to find a different anchor rather than to accept it.

**Validate against an external source if one exists.** The recovered inheritance was checked against the SDK headers' declared `class X : public Y`: of 581 classes in both, 399 agreed exactly, 154 differed only in template form (`igObjectList` here vs `igTObjectList` declared), and 28 were genuine version drift - 95.2% agreement. The 28 are themselves useful, since they are precisely the classes refactored between versions.

This source beats an SDK because it needs no version reasoning and it covers the game developer's own classes, which no SDK contains.
