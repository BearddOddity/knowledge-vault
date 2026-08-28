<!-- summary: Password recovered by inverting pow(129, char, 251) then XOR - the character was the exponent -->
# prime-exe-crackmes-one

**Technique:** String xref to the prompt, decompile, recognise modular exponentiation, invert by table lookup over printable ASCII

## Notes

First real third-party crackme solved with this toolchain. From crackmes.one,
`prime.exe`, 13,824 bytes, 32-bit mingw console binary,
sha256 `ca42dbc61eab6c5b591489b8251a8e405983be7a86726165f1984cb30bb5c4f0`.

**Password: `Pr1me_Numb3r5_4r3_s0_P0w3rFull`**

## The check

```
for each input char c at index i:
    t = pow(129, c, 251)                 # 0x81 base, 0xfb modulus (prime)
    t ^= "Th4t's a P455W0rD"[i % 17]
    out += "%02x" % t
strcmp(out, "113e5c6e...84646") == 0     # 60 hex chars => 30 bytes
```

The key insight, and the whole point of the "Do you know prime numbers
properties?" banner: **the input character is the exponent, not the base.**
The helper reads

```c
int f(byte base, char exp, byte mod) {
    result = 1;
    for (i = exp; i != 0; i--) result = (base * result) % mod;
    return result;
}
```

called as `f(0x81, c, 0xfb)`. Read carelessly this looks like the character is
being transformed as a base; the argument order says otherwise, and getting it
backwards produces a solver that finds nothing.

## Inversion

A discrete log in principle. In practice the input is constrained to printable
ASCII, so building `{pow(129, c, 251): c for c in range(0x20, 0x7f)}` and
looking each byte up is a few lines and instant. Reach for the constraint before
the mathematics.

The blob is 30 bytes, so the password length is known before solving.

## Anti-debug

`NtSetInformationThread(GetCurrentThread(), 0x11, 0, 0)` — ThreadHideFromDebugger.
Non-zero return makes main exit silently.

**It is resolved through `GetProcAddress`, so it never appears in the import
table.** An import-table scan misses it completely; only the string `ntdll.dll`
and `NtSetInformationThread` in .rdata give it away. This drove a fix to
`re-triage`, which now cross-references strings against the API watch list.

Static analysis ignored it entirely — the binary was never run under a debugger.

## A trap in the control flow, checked rather than assumed

```c
if (strcmp(computed, expected) != 0) { FUN_004015a5(); }
puts("well done");
```

The failure call is followed by an unconditional success message. If that
function returned, every password would print "well done". Tested with a wrong
password: it prints `fail` and exits, so the crackme is sound. Worth verifying
rather than assuming — the same shape in a buggy crackme is a free bypass.

## Verification

| Input | Result |
|---|---|
| `Pr1me_Numb3r5_4r3_s0_P0w3rFull` | `well done` |
| `WrongPassword123` | `fail` |

Run under Wine via `re-run`, which selected the 32-bit prefix from the PE header.
Rules for the other two crackmes in this batch forbid patching; this one was
solved by recovering the password, not by patching.
