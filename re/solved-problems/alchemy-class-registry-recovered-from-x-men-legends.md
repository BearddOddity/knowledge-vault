<!-- summary: Recovered 696 class names, their sizes, inheritance and 2,110 attributable functions from the game's own startup registration table, after two external symbol sources had largely failed -->
# alchemy-class-registry-recovered-from-x-men-legends

**Technique:** Follow one unnamed function back to a push site that is not inside any function, read the other pushes, then enumerate the callers of the call target

## Notes

# Recovering a class registry from X-Men Legends (Xbox)

## The goal

Name functions in a 17,900-function Xbox binary whose engine is Intrinsic
Alchemy, Vicarious Visions' middleware. No debug info, no PDB, and the SDK
version the game shipped with (Alchemy 3.0) is lost media.

## What was tried first, and how it went

**1. Alchemy SDK 5.0 headers (2010).** Nearly useless for slot order:
`igObject.h` declares 18 virtuals and `igNode.h` 10, against real vtables of
31-33 slots, because most virtuals come from macros.

**2. Alchemy 2.5 DLLs (2003), from the Maya Artist Pack.** The InstallShield
`data1.cab` unpacks with `unshield` to sixteen DLLs that export both their
methods and their `??_7Class@@6B@` vftable symbols - about 30,000 named
reference bodies. Real, but the version gap defeats every positional approach:
vtable lengths disagree inconsistently (igNamedObject 17 slots vs 21 in the
game, igNode 31 vs 33) and the object layout is skewed the other way (a member
at `this+0x14` in 2.5 sits at `this+0x10` in the game).

Matching by *code shape* rather than position, with call-graph corroboration and
a second SDK version for cross-version agreement, produced **45 names** from
~70,000 reference bodies. Worth having, but small against 17,900 functions,
because most of a game binary is the developer's own code that no SDK contains.

## What actually worked

An unnamed destructor the matcher could not identify was followed back:

```
002766a0  (the destructor)
  <- called by 0027c080
     <- referenced at 002894ac, which is in .text but inside NO function
```

An address referenced from `.text` yet not covered by a function is a `push`
operand. Reading the surrounding block:

```
mov al,[0x5bdf6c]; test al,al; jnz     ; run-once guard
push 0x47180c
push 0x255fc0        ; registerFields
push 0x27c080        ; deleting destructor wrapper
push 0xc8            ; SIZE - 200 bytes
push 0x405f40        ; -> "igBumpMapShader"
push 0x250870        ; own getClassMeta
push 0x19c140        ; parent accessor
push 0x281670        ; parent's registration block
push 0x5bdb0c        ; this class's _Meta global
push 0
call 0x2235d0
```

`0x405f40` is the literal string `igBumpMapShader`. Listing the callers of
`0x2235d0` gave **698 registration sites, every one carrying a class name**.

## Yield

| | |
|---|---|
| registration sites | 698 |
| distinct classes | 696 (682 `ig*`, 14 the game developer's own) |
| code pointers attributable to a class | 2,110 |
| metaobject globals named | 1,115 |
| class sizes recovered | all 698, 8 to 9,548 bytes |
| functions renamed in one pass | 717 |
| globals labelled | 696 |

## Establishing the slot roles

Statistics first, to see the shape:

| slot | uses | distinct | reading |
|---|---|---|---|
| A | 429 | 428 | class-specific, absent from 269 sites |
| B | 429 | 428 | class-specific, absent from the same 269 |
| C | 698 | 696 | class-specific, present for every class |
| D | 698 | 143 | shared in groups |
| E | 698 | 143 | shared, co-varies exactly with D |

Then one read per slot, never an inference from position:

- **A** = `registerFields` - it writes 25 fields into its *own* class's meta global
- **B** = deleting destructor wrapper - it calls the real destructor
- **C** = own `getClassMeta` - the root class's C returns the root's `_Meta`
- **D** = a parent accessor
- **E** = the parent's registration block

A and B exist only for the 429 instantiable classes; abstract classes register
no fields and have no destructor.

## The mistake worth recording

Slot D was read as "the parent's slot C" on the strength of one example. It
resolved **120 of 696 parents, all of them the root class** - a generalisation
from a single case. Slot E points *into* the parent's push block, so matching it
against the site addresses resolved **695 of 696**.

The lesson is the lopsided answer: when a resolution method returns one
dominant value for a small fraction of the input, that is a signal to find a
different anchor, not to accept the result.

## Validation

Against the SDK headers' declared `class X : public Y`, over the 581 classes
present in both: 399 agree exactly, 154 differ only in template form
(`igObjectList` here vs `igTObjectList` declared), 28 are genuine version drift.
**95.2% agreement.**

An independent confirmation landed on the boot bug: the type descriptor the boot
dies on had been documented weeks earlier as allocating `0x64` = 100 bytes. The
registry lists `igMetaObject` at exactly **100 bytes**, naming the object and
confirming that the registry's size column is the value the descriptor is
supposed to hold.

## Transferable procedure

1. Take one function you cannot name and walk its callers.
2. Look for a referenced address that is in a code section but inside no
   function - that is a `push` operand.
3. Read the whole push block; one operand will point at a printable identifier.
4. Take the `call` target at the end and enumerate its callers.
5. Derive slot roles from statistics *plus* one read each, never position alone.
6. Validate against any external declaration you have, and treat the
   disagreements as findings rather than noise.
