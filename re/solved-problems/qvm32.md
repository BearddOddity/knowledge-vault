<!-- summary: A bytecode VM whose interpreter hides the password check from x86 tracing; the oracle is VM instructions executed, not x86 instructions. -->
# qvm32

**Technique:** Emulated the binary under Unicorn with the six libc calls stubbed, then counted VM-level dispatch iterations as a side channel to recover the password one byte at a time. Password: iWasteMyTime

## Notes

TARGET
  qvm32, crackmes.one, 2016. 32-bit Linux ELF, 55,980 bytes.
  Prompts "ENTER PASS : ", answers FAILED or WIN.
  Password: iWasteMyTime (12 chars).

RECOGNISING IT FROM TRIAGE ALONE
  .text 46 KB, .rodata 8 BYTES, .data 5 KB writable, 8 imports
  (write/read/rand/malloc/free/exit - no printf/scanf), 53 strings total.

  Almost all code and almost no read-only data means the strings and logic are
  not where a compiler would put them. That is the signature of a bytecode VM
  with its program in writable data. Confirmed by the dispatch fetch:

    mov   eax, [0x8055504]                ; VM program counter
    movzx eax, byte [eax + 0x8054130]     ; fetch opcode
    cmp   eax, 0xee                       ; halt opcode
    je    exit

  The bytecode table at 0x8054130 is all zeros in the file and is built at
  runtime by a rand()-driven loop. rand() is never seeded, so it is identical
  on every run.

  A first pass searched for an indirect jump (`jmp [table+reg*4]`) as the VM
  signature, found only one hit, and concluded "not a VM". That hit was in data
  past the end of .text. Dispatch here is a comparison chain, not an indirect
  jump, so absence of `jmp reg` proves nothing. The reliable signature was the
  section-size ratio, available from triage before any disassembly.

THE TRAP: CONSTANT X86 CONTROL FLOW
  Tracing x86 execution for two different wrong passwords gives byte-identical
  traces - same length, no divergence at any index. The natural reading is that
  the check is branchless and constant-time, which sends you looking for an
  arithmetic verdict (`ptr = FAILED + 7 * correct`) that does not exist.

  The real explanation: it is an interpreter. The interpreter loop runs the same
  x86 path whatever the bytecode is doing, so x86 control flow cannot reveal
  VM-level branching. And two WRONG passwords take the same VM path as each
  other, so comparing two failures proves nothing at all - it only shows that
  both fail the same way.

  The branch becomes visible only once a password is correct far enough to pass
  the first comparison. Never conclude "no data-dependent branching" from
  traces of inputs that are all wrong.

THE ORACLE
  Count VM dispatch iterations by hooking the single fetch instruction:

    wrong first byte    366 VM steps
    correct first byte  368 VM steps
    each further correct byte    +2 to +6 steps

  That is a clean byte-at-a-time oracle: 12 positions x ~95 printable
  candidates, a few thousand emulations, under a minute.

  Structure visible in the VM trace: steps 0-309 build tables from rand(); step
  310 is the read; steps 311-334 are twelve 0xDD/0xCC pairs, one per password
  byte; then compare (0x66) and conditional jump (0x99). The check is
  `password[i] ^ K[i]` against a constant, K[0] = 0x13.

  read() takes exactly 12 bytes, so "iWasteMyTimee" also wins - anything past
  the twelfth character is never read.

EMULATION SETUP
  Six libc functions, one call site each, so Unicorn plus six stubs runs the
  real code exactly. Verified by reproducing the real binary's output byte for
  byte before trusting any measurement.

DEAD END, AND THE BUG THAT CAUSED IT
  rand() was stubbed by calling the host's glibc through ctypes rather than
  reimplementing glibc's additive-feedback generator. Correct in principle and
  it removes any doubt about matching - but the host's sequence position
  carries over between emulations in the same process, so only the FIRST run in
  a process matched the real binary.

  Every run after that built a different table. A sensitivity sweep over ~25
  runs then produced a clean, self-consistent and completely wrong model
  (`p[0] ^ p[1] == 0x24`), which failed against the real binary. The model
  looked convincing precisely because it was derived from internally consistent
  garbage.

  Fix: srand(1) at the start of every emulation - the program never seeds, so a
  real process always starts from glibc's default seed of 1. Detect this class
  of bug by running the SAME input twice in one process and checking the
  instruction counts match.

  Second smaller error: the compared pair was assumed to be the two VM
  variables that visibly changed with the password (0x80554f0 and 0x80554f8).
  Watching actual memory reads at the compare instruction showed it reads
  0x80554f0 against 0x80554f4. Watch the reads rather than guessing which
  variables matter.
