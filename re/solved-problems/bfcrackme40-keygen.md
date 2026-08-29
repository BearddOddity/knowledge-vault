<!-- summary: Keygen recovered by disassembling VB6 P-code; the check is a string range, not an equality -->
# bfcrackme40-keygen

**Technique:** Unpack from memory, then disassemble P-code with the community opcode table

## Notes

**Solved.** Supersedes `bfcrackme40-partial`, which recorded the black-box stage.

`BFCrackMe40.exe`, crackmes.one, Boba Fett / Lockless Cracking Crew, Nov 2000.
UPX 0.82 (renamed sections) wrapping a VB6 **P-code** binary. Author's rules:
keygen required, no patching.

## The algorithm

From the Login handler's P-code at `0x402c38`
(stream `0x402a30`-`0x402c38`, found via `procdsc_va - wPCodeBackOffset`):

```
A = Asc(first char of Name)
B = Asc(last char of Name)
C = Asc(second-to-last char of Name)
X = str(A) + str(B) + str(C)        # decimal digits, concatenated
```

The program then computes `X+1` and `X-1` **numerically**, converts both back
to strings, and requires

```
(X-1) < serial < (X+1)              # GtStr / LtStr - STRING comparison
```

Company is not checked; it is only echoed in the success message. Verified by
registering with the company changed and the serial unchanged.

**Keygen: `serial = str(A) + str(B) + str(C)`.**

| name | serial | verified |
|---|---|---|
| `test` | `116116115` | registers |
| `BeardedOddity` | `66121116` | registers |
| `abcd` | `9710099` | in range |
| `ac` | `979997` | in range |

## Why black-box probing stalled for so long

The comparison is **lexicographic, not numeric**, so a whole family of strings
satisfies it. That produced two misleading effects:

- Several different serials were accepted for one name (`abc` took both
  `9799979899` and `97999899`), which made every "rule" seem confirmed and then
  contradicted.
- The natural answer, plain `X`, was never guessed for `test`, because the
  accepted values for other names looked like character-code concatenations of
  the whole name rather than three specific characters.

The three consecutive values that kept appearing in the heap - e.g. `116116114`,
`116116115`, `116116116` - were exactly `X-1`, `X`, `X+1`. They were the answer
sitting in plain sight, misread as loop counters.

## Lesson

Black-box probing produced *working serials* but a *wrong model*, and no amount
of further probing was going to fix that - each new experiment fitted the bad
model. Reading the code settled it in one pass. When probing starts yielding
contradictory rules, that is the signal to stop probing, not to probe harder.

The decode needed the community opcode table (see the `vb6` pattern); guessing
opcode semantics would have produced another confident wrong answer.
