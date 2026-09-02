# ghidra

## Retype a variable in the decompiler with Ctrl+L (or Ctrl+Sh…

Retype a variable in the decompiler with Ctrl+L (or Ctrl+Shift+L to set the function's return type). Most unreadable decompilation is not obfuscation, it is Ghidra guessing the wrong type — fixing one struct pointer often collapses twenty lines of casts into a field access.

## **An RTTI vtable walk needs an end test, and "is this a cod…

**An RTTI vtable walk needs an end test, and "is this a code pointer?" is not one on an XBE.**

A script that walks each vtable forward and stops at the first dword that is not a code pointer will not stop. Ghidra's XBE loader marks `.rdata` and `.data` **executable**, so every dword pointing into initialised memory passes the test. Vtables are packed back to back, so each walk runs out of its own vtable and into the following ones, attributing later classes' slots to the earlier class.

Measured on X-Men Legends: of 3,890 `<Class>::vfuncN` names produced that way, **1,282 were out of bounds** - and 314 of those had created a "function" inside `.rdata`/`.data`, disassembling RTTI structures as code. `Gap::Sg::igNode` really has 33 slots; it carried 46 names, and `vfunc33` was a complete object locator.

**The correct bound.** MSVC lays out `[COL][slot0][slot1]...`, so every vtable is preceded by exactly one complete-object-locator pointer. Collect every position whose dword is a valid COL (signature 0, and +0x0C points at a type descriptor whose +8 starts `.?A`) and whose following dword is a code pointer; a vtable then runs from there to the next such position. That found 743 vtables and bounded all of them.

**Deriving "is code" without the flags.** Since the section characteristics are useless here, take the set of memory blocks that contain at least one function entry point and treat those as the code blocks. Note this is self-poisoning if a previous bad walk already created functions in `.rdata` - clean those up first, or the block set includes `.rdata` and the end detection weakens again.

**Two practical notes when fixing this up.**

- Wrap the rename in try/catch and count failures. A single clashing symbol should not abort a 1,300-item pass.
- Renaming a function that a thunk points at silently renames the thunk too, so a name-pattern count taken *during* the same loop will disagree with the count taken before it. 1,282 out-of-bounds names were stripped as 1,279 direct renames plus 3 thunks that followed their targets. The discrepancy is benign but looks alarming if you do not expect it.
