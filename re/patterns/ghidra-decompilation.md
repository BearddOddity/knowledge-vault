<!-- summary: Varargs hide arithmetic until the prototype is set -->
# ghidra-decompilation

## Varargs hide arithmetic until the prototype is set

Ghidra will not show the arguments to a variadic function it has not identified, and it silently drops the code that computes them. The result looks like the program does nothing.

**What it looks like:** a serial check decompiled to

```c
if (local_50[0] != '\0') {
    pcVar3 = local_50;
    do { pcVar3 = pcVar3 + 1; } while (*pcVar3 != '\0');
}
FUN_00402a10((int)acStack_b0, "%04X-%04X-%04X");
iVar5 = strcmp(acStack_b0, local_90);
```

The loop appears to walk the string and throw the result away, and the format string has no arguments. Both are illusions: the hash is computed in registers that are passed as varargs, and Ghidra cannot show what it does not know the callee accepts.

**The fix:** identify the callee and set its prototype.

```
set_function_prototype(function_address="0x00402a10",
                       prototype="int sprintf(char * buf, char * fmt, ...)")
```

Re-decompiling the caller then yields the whole algorithm:

```c
uVar5 = 0x1505;
do {
    uVar5 = ((uint)local_50[0] ^ uVar5 * 0x21) << 3 | uVar5 * 0x21 >> 0x1d;
    ...
} while (local_50[0] != 0);
uVar5 = uVar5 ^ 0xc0debabe;
sprintf(acStack_b0, "%04X-%04X-%04X", uVar5 >> 0x10, uVar5 & 0xffff,
        (uVar5 >> 8 ^ sVar4) & 0xffff);
```

**How to spot the callee:** a stripped mingw or MSVC binary hides the CRT names, but the call shape gives it away - a stack buffer as the first argument and a format string as the second is `sprintf`; the same with a size in between is `snprintf`. Statically linked CRT functions are worth prototyping once, since they are called from many places.

**Why it matters:** this is the difference between "the decompiler output is useless, the binary must be obfuscated" and having the algorithm in front of you. Suspect a missing prototype before suspecting obfuscation. Reading `h * 0x21` as `h * 33`, i.e. `(h << 5) + h`, also identifies this immediately as djb2.
