<!-- summary: Detect P-code before disassembling, and attack it dynamically -->
# vb6

## Detect P-code before disassembling, and attack it dynamically

A VB6 binary is either native x86 or P-code for the msvbvm60 interpreter. Disassembling P-code as x86 produces confident nonsense, so settle this first.

**How to tell.** Every VB5/VB6 executable carries a `VB5!` header; `lpProjectData` at offset 0x30 points to a ProjectInfo struct whose `lpNativeCode` (offset 0x20) is **zero for P-code**:

```
VB header at 0x0040135c
  lpProjectData   : 0x00401498
ProjectInfo
  code start/end  : 0x00402cb0 - 0x00402cc0    <- 16 bytes, far too small for real code
  lpNativeCode    : 0x00000000   -> P-CODE
```

A tiny code range corroborates it. Before finding this, the "code" around a string reference disassembled as `aam`, `sbb`, `push ds` - garbage, because it was a data table, not code.

**Do not expect the runtime exports to be called.** A breakpoint on `msvbvm60!__vbaStrCmp` (found via the export table plus the module base from `/proc/pid/maps`) **never fired** during a serial check. The P-code interpreter compares strings with its own opcodes rather than calling the exported helper. Worth knowing before spending time on it.

**What does work: read the heap.** VB6 keeps strings as BSTRs (UTF-16LE), so inputs and computed values are readable text in memory:

```
mem-strings <name> 6            # UTF-16 strings with addresses, whole process
```

**The trap that cost the most time here:** every keystroke leaves its own BSTR, so the heap fills with prefixes of whatever you typed. A "computed value" that looks convincing is often your own half-typed input. Always type a serial made of characters that cannot appear in the answer - a single `Q` or `Z` - before dumping. Comparing a polluted dump with a clean one makes the difference obvious.

**Also note:** a value the program compares against may never exist as one contiguous string. In this target the correct serial was never found in memory; only fragments of the loop that builds it. Piecewise comparison means memory scanning shows you the pieces, not the answer.
