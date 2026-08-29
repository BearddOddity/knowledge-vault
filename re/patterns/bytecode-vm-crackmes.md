<!-- summary: Recognise a VM from the section-size ratio, then attack it one level up: count… -->
# Bytecode VM crackmes

## Recognise a VM from the section-size ratio, then attack it one level up: count VM dispatch iterations, not host instructions, as the progress oracle.

## Recognising one

From triage, before any disassembly:

- `.text` enormous relative to file size
- `.rodata` tiny or empty
- `.data` large and writable
- Very few imports, and no `printf`/`scanf`-style formatting
- Very few strings

Almost-all-code with almost-no-read-only-data means the strings and logic are
not where a compiler would put them. They are bytecode in writable data.

Do NOT rule out a VM because there is no `jmp [table + reg*4]`. Dispatch is
often a comparison chain or a computed offset instead, and searching for the
textbook indirect jump produces a confident false negative. The section ratio is
the reliable tell.

Confirm by finding the fetch: a load from a fixed address (the VM program
counter), a byte load indexed by it, and a compare against a halt opcode.

    mov   eax, [PC_ADDR]
    movzx eax, byte [eax + BYTECODE_BASE]
    cmp   eax, HALT_OPCODE
    je    ...

## The trap that wastes the most time

Host-level control flow is CONSTANT no matter what the input is, because an
interpreter runs the same loop whatever the bytecode does. Diffing execution
traces for two inputs shows no divergence, which reads as "the check is
branchless and constant-time" and sends you hunting for an arithmetic verdict
that does not exist.

Worse, if both test inputs are wrong they take the same VM path as each other,
so the comparison proves nothing whatsoever. Never conclude "no data-dependent
branching" from a set of inputs that are all failures - a wrong-vs-wrong diff
is not evidence.

## The oracle

Hook the single fetch instruction and count how many times it executes. That
counts VM instructions rather than host instructions, and it exposes the VM's
control flow directly. A byte-by-byte check then shows as a step count that
grows with each correct character, giving standard one-byte-at-a-time recovery
at a few thousand emulations for a full password.

The same hook makes the VM's structure readable: log (pc, opcode) per step and
the phases separate cleanly - table setup, input read, a repeating pair of
opcodes per input byte, then compare and branch.

## Emulate rather than read

An interpreter body is usually obfuscated (mixed boolean arithmetic turns every
add into an and/or/not/shift chain). Reading it is expensive and unnecessary:
count the imports first. A handful of libc calls with one call site each means
an emulator plus that many stubs runs the real code exactly, and the emulator is
what makes instruction counting and mass candidate testing cheap.

Always reproduce known real behaviour byte for byte before trusting any
measurement taken from the emulator.

## Stubbing rand() correctly

Programs that never seed `rand()` get glibc's default seed of 1, so the sequence
is fixed and any table built from it is identical on every run.

Calling the host's `rand()` through ctypes is better than reimplementing
glibc's additive-feedback generator - except that the host's sequence position
persists across emulations in the same process. Only the first run then matches
the real binary; every later one silently uses different values.

This failure is dangerous because it is quiet. A sensitivity sweep across many
drifting runs yields an internally consistent, entirely wrong key model that
looks convincing until it is tested against the binary.

**Reset the generator at the start of every emulation, and test for this class
of bug by running the same input twice in one process and checking the
instruction counts are identical.** That two-line check catches any leaked state
between runs, not just rand().

## Identify the compared operands by watching, not guessing

When several variables visibly change with the input, the ones being compared
are not necessarily the ones that look most relevant. Hook memory reads at the
comparison instruction and record the addresses actually read.
