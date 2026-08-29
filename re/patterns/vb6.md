<!-- summary: Detect P-code before disassembling, and attack it dynamically, Locating P-code… -->
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

## Locating P-code procedures through the object structures

Finding a VB6 form's event handlers without a decompiler. Verified against a real target; the offsets below were confirmed by reading bytes, not recalled.

**Chain:** `VB5!` header -> ProjectInfo -> ObjectTable -> object descriptors -> ObjectInfo -> method array.

```
VB5! header   +0x30  lpProjectData
ProjectInfo   +0x04  lpObjectTable
              +0x20  lpNativeCode   (0 => P-code)
ObjectTable   +0x2a  dwTotalObjects (WORD)
              +0x30  lpObjectArray
object desc   +0x00  lpObjectInfo          (0x30 bytes per object)
ObjectInfo    +0x20  method count
              +0x24  lpMethods -> array of procedure addresses
```

**Two traps.** Several fields sit one DWORD from where a half-remembered layout puts them, and a wrong guess yields "0 objects" or an array of zeros rather than an obvious error. Resolve every DWORD in a descriptor and print the ones that point at strings or plausible code - the real layout becomes obvious in one pass. The `+0x20` field of the object descriptor also looks like a method array and is not; the count and pointer live in ObjectInfo.

**Procedure layout.** Each procedure begins with a header (~0x30 bytes) starting with a back-pointer to its ObjectInfo, followed by a table of local-variable descriptors (`XX ff 0Y 00`), then the P-code.

**Reading the P-code without the opcode table**, structure is still visible:

```
04 54 ff          push local  (XX ff = negative ebp offset)
f5 01 00 00 00    push 4-byte literal
0a 02 00 0c 00    call a runtime helper
```

Repeated near-identical blocks differing only in a literal (1, 1, 2) indicate a loop over `Mid$(s, i, 1)`. That is enough to confirm a hypothesis formed from black-box testing, but **not** enough to derive an algorithm - assigning opcode semantics by guesswork produces confident nonsense. Get the opcode table or a P-code-aware tool before claiming a decode.

**Also:** a procedure's body may be absent from a memory dump - one here ran straight into `cc cc`/`e9 e9` filler and zeros. Check the body is resident before concluding anything about it.

## Disassembling P-code with a real opcode table

P-code is fully readable once you stop guessing opcodes. Two public sources carry the reverse-engineering community's table:

- `stark9000/vb6-pcode-opcode-db` - browsable reference, `assets/opcodes.json` (1159 entries, mnemonics + notes). Credits MrUnleaded, Moogman, Napalm.
- The **`visualbasic` crate on crates.io** (used by `BinFlip/bn-vb6`) - `data/opcodes.csv`, 1536 entries with **verified instruction sizes and operand formats** traced from MSVBVM60.DLL handlers. This is the one to build a disassembler on; the JSON above lacks sizes.

```
curl -sL -o vb.crate https://static.crates.io/crates/visualbasic/visualbasic-0.1.0.crate
tar xzf vb.crate      # data/opcodes.csv, src/pcode/*.rs
```

CSV columns: `table, opcode, size, mnemonic, operands, pops, pushes, ...`
`size` includes the opcode byte and excludes the lead byte; `-1` means variable
length with a `u16` count following.

**Dispatch tables.** Lead bytes `0xFB`-`0xFF` select extended tables 1-5; anything else is table 0.

**Operand formats:**

```
%1 1 byte   %2 i16   %4 i32          %a stack var (i16 EBP offset)
%s const-pool index  %l jump target  %c control index
%v vtable ref (2x i16)               %x external call (2x i16)
```

**The layout fact that makes or breaks this:** the address in an ObjectInfo method array points at the **ProcDscInfo**, and the P-code stream sits *immediately before it*:

```
pcode_start = procdsc_va - wPCodeBackOffset     # u16 at ProcDscInfo+0x08
```

ProcDscInfo: `+0x00 lpObjectInfo, +0x04 wArgSize, +0x06 wFrameSize, +0x08 wPCodeBackOffset, +0x0A wTotalSize`.

Decoding *forward* from the descriptor reads the cleanup tables and then filler - which looks exactly like "the code is not in the dump", and cost a wrong conclusion here before the layout was checked.

**What the output looks like** - readable enough to recover an algorithm directly:

```
00402ac2  f5 01 00 00 00   LitI4          1
00402ac7  04 78 ff         FLdRfVar       var_88
00402ad2  0a 04 00 0c 00   ImpAdCallFPR4  (0x4,0xc)     <- Mid$/Left$ style call
00402ae4  0b 03 00 04 00   ImpAdCallI2    (0x3,0x4)     <- Asc
00402b20  2a               ConcatStr
00402b30  ab               AddR8                        <- X + 1
00402b53  af               SubR4                        <- X - 1
00402b78  fb 71            GtStr                        <- string comparison
```
