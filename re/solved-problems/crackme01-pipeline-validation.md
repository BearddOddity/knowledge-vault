<!-- summary: First end-to-end run of the RE pipeline: triage to keygen on a self-authored 32-bit PE -->
# crackme01-pipeline-validation

**Technique:** String xref to the failure message, then set the sprintf prototype to expose the hidden key derivation

## Notes

## What this was

**Not a real challenge.** `crackme01.exe` was written and compiled here specifically to exercise the toolchain end to end without downloading an untrusted third-party binary. The answer was known in advance, so this validates the *pipeline*, not blind solving ability. Recorded because the route through the tools is what is reusable.

Target: 32-bit PE, mingw, `-O1 -s` (stripped), 46,592 bytes,
sha256 `88d7b9b5c08ac485d3ff05f9e046706c54f5e74d294dfd2d420381f98783d2a0`.

## Route

1. **`re-triage`** — not packed (entropy 6.05, ordinary sections), flagged
   `IsDebuggerPresent` as anti-debug, and surfaced the gift strings
   `Correct! Well done.` and `Wrong serial, try again.`
2. **`import_binary`** — 13 seconds including analysis, unattended.
3. **String xref**: `list_strings(filter="serial")` gave the failure message at
   `0x0040a08d`; `get_xrefs_to` pointed at `FUN_00401560`. That function was the
   check. This is the fastest route into a crackme and it worked first time.
4. **Decompile** — showed the shape (anti-debug guard, length check, sprintf,
   strcmp) but the key derivation was **missing**, rendered as a pointer walk
   that discarded its result.
5. **Set the `sprintf` prototype** on `FUN_00402a10`. Re-decompiling exposed the
   whole algorithm. See the `ghidra-decompilation` pattern.
6. **Keygen** in Python, then verified against the binary.

## Algorithm

```
h = 0x1505
per char c:  h = rotl32((h * 0x21) ^ c, 3)     # h*0x21 == h*33 == djb2
h ^= 0xC0DEBABE
serial = "%04X-%04X-%04X" % (h>>16, h&0xFFFF, (h>>8 ^ len(name)) & 0xFFFF)
```

Name must be at least 4 characters. `IsDebuggerPresent` at entry returns 2 with
"Nice try." — irrelevant to static analysis, which is the general lesson about
anti-debug: it costs nothing if the binary is never run under a debugger.

## A false alarm worth remembering

The decompiler renders the rotate as
`(c ^ h*0x21) << 3 | (h*0x21) >> 0x1d`, which reads as though only the low half
is XORed with the character. Two candidate implementations were written and both
produced identical output — because `c` is a byte, it only touches bits 0-7,
which after `<< 3` occupy bits 3-10 and never reach the top three bits the
rotate carries. The ambiguity was illusory.

The habit that resolved it: implement both readings and test against the
binary rather than reasoning about which the compiler meant.

## Verification

| Case | Result |
|---|---|
| `oddity` + generated serial | Correct |
| `oddity` + wrong serial | Wrong |
| `BeardedOddity` + generated serial | Correct |
| 3-character name | Wrong (length guard) |

Testing the negative cases matters: a keygen that accepts everything looks
identical to a correct one if only the success path is tried.

Verified with `re-run`, which picked the 32-bit Wine prefix from the PE header.
