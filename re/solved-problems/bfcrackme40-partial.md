<!-- summary: UPX-0.82 VB6 P-code crackme: unpacked and valid serials found, but no general keygen yet -->
# bfcrackme40-partial

**Technique:** Dynamic unpacking from process memory, then black-box experiments against the live GUI

## Notes

**Status: partially solved.** Working serials recovered for specific names; the
general rule is NOT pinned down. Recorded now because the route and the dead
ends are worth more than the answer.

`BFCrackMe40.exe`, crackmes.one, Boba Fett / Lockless Cracking Crew, Nov 2000.
11,264 bytes packed, sha256
`9bf3bc67f641705fda40ec5001e2b3ed0e8f39ca76e4fcace9e90e6311a79c6c`.
Author's rules: keygen required, **no patching**.

## Getting to analysable code

1. **UPX 0.82 with renamed sections** - see the `packers` pattern. Renaming back
   to UPX0/UPX1 got past detection but modern UPX (4.x *and* 3.96) refuses the
   obsolete format.
2. **It would not run**: `msvbvm60.dll` (ordinal 619) missing. Wine's loader
   failed before the unpacking stub executed, so no self-unpacking either.
   Installing the VB6 runtime (`winetricks vb6run`) fixed both at once.
3. **Dumped the unpacked image** from `/proc/<pid>/mem` at 0x400000 and fixed
   the section headers so offsets matched RVAs.
4. **It is P-code**, not native - `lpNativeCode = 0`. Static x86 analysis was
   therefore pointless, which explains the garbage disassembly seen earlier.

## Confirmed behaviour

Serial depends **only on the Name** - changing Company from `XY` to `ZZZ` with
an unchanged serial still registered. Company is displayed, not checked.

Verified by running the binary:

| name | serial | result |
|---|---|---|
| `ac` | `97999799` | registers |
| `ac` | `979999` | rejected |
| `AB` | `65666566` | registers |
| `ad` | `9710097100` | registers |
| `abc` | `9799979899` | registers |
| `abc` | `97999899` | registers |
| `abcd` | `971009899100` | registers |
| `abcd` | `97100979899100` | rejected |
| `abcd` | `97100979899` | rejected |
| `abcde` | `9710199100101` | rejected |
| `test` | every form tried | rejected |

The shape is clear: `Asc(first) & Asc(last)` followed by character codes. What
is **not** resolved is which characters are included - it varies with length,
and `abc` accepts two different serials, so the comparison is looser than
equality.

## Why memory scanning stalled

The heap only ever held the prefix and three loop values ending at
`Asc(last)` - e.g. for `abcd`: `97100`, `9710098`, `9710099`. The
known-correct `971009899100` **never appears as a contiguous string**. The
program compares piecewise rather than building the whole serial, so there is
no single value to read out.

## Dead ends, in order

- `upx -d` with 4.x, then 3.96 - both refuse pre-1.00 formats.
- Breakpoint on `msvbvm60!__vbaStrCmp` - never fires under P-code.
- Reading "computed values" from the heap - most were **my own keystrokes**.
  Each character typed leaves a BSTR, so the heap fills with prefixes of the
  input. Fixed by typing a serial (`Q`) that shares no characters with any
  plausible answer.
- Assuming `abc` proved the rule - `a,b,c` are 97,98,99, simultaneously the
  character codes *and* a consecutive run, so it fitted two different
  hypotheses. Choosing a name like `ac` disambiguated it. **Pick test inputs
  that can only match one hypothesis.**

## To finish it

Decode the P-code properly. That needs a VB6 P-code disassembler; reading
opcodes by hand from the code section is the fallback. Black-box probing got
this far and then stopped paying.
