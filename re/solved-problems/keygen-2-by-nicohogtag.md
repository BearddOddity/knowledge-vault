<!-- summary: Shipped STABS debug symbols named every local, turning the check into readable C; the algorithm reads two bytes past its input buffer, so the expected serial depends on the saved EBP. -->
# Keygen #2 by Nicohogtag

**Technique:** Static-only solve. re-triage showed .stab/.stabstr sections present (MinGW g++ -g, 2013), so the STABS table was parsed directly out of the PE to recover the names, types and stack offsets of every local in main. The check is 434 bytes inline at 0x401390 with no anti-analysis of any kind. The one real obstacle was an out-of-bounds read in the crackme itself, resolved by reading the value out of the live process rather than guessing it.

## Notes

TARGET
  Keygen #2 by Nicohogtag, crackmes.one, built 2013-02-12, 597,086 bytes
  sha256 b279b6e034480c48890eb147b3eded42fbc51b43d604156492117bfa436a5a42
  PE32 console, MinGW g++, entropy 6.24, not packed, no anti-debug.

THE CHECK (all of it, inline in main at 0x401390)

  num = b = 0; b = 0x80899; c = 7;
  for (i = 0; i <= 9; i++) { a = user[i]; num += a; b += num; }
  c *= (num + b);
  c *= (c - num) + 13 * (b / 2);
  if (abs(c) == serial) "Congrats, now write me keygen!";

  num is the plain sum of the bytes; b is 0x80899 plus the sum of the running
  prefix sums, i.e. a positionally weighted sum where user[j] carries weight
  (10 - j). All arithmetic is 32-bit signed and wraps. b/2 truncates toward
  zero, which matters because b can be made negative.

STABS WAS THE WHOLE SHORTCUT
  .stab (12-byte entries) + .stabstr (115 KB) survived in the binary. Parsing
  the N_LSYM entries for the crackme's own source file gave, exactly:

    user   char[0..7]  ebp-8     serial int  ebp-12    num int  ebp-16
    a      char        ebp-17    b      int  ebp-24    c   int  ebp-28
    i      int         ebp-32

  Reading that table took one Python snippet and removed all guesswork about
  which stack slot was which. Worth checking for on any GCC/MinGW target: grep
  the section list for .stab before assuming variables are anonymous.

  A caution it also settled: re-triage flagged the string "serial:(0,3)" as an
  interesting lead. It is not a hint about substring ranges - it is a STABS type
  descriptor, "a variable named serial of type (0,3)", where (0,3) is int. A
  strings-only reading of that would have sent the analysis somewhere wrong.

THE OUT-OF-BOUNDS READ
  user is char[8] but the loop runs i = 0..9. user[8] and user[9] are the low
  two bytes of the saved EBP at [ebp] and [ebp+1] - the author's off-by-two.
  The expected serial therefore depends on the stack address of main's frame.

  Resolved by observation, not by guessing at plausible stack addresses. The
  program ends with system("pause"), so main's frame is still live while it
  waits for a key. Launching it with stdin held open by a trailing sleep, then
  scanning /proc/<pid>/mem for the username string, gives &user directly; every
  local is then at a known offset from it. Read out: saved ebp 0x0066ff30, so
  the tail bytes are (0x30, 0xff), and num=648 b=530803 c=744578194 for the
  probe name - which then matched the model exactly on the first try.

  0xff is read as a SIGNED char and contributes -1, not 255.

  Under the lab's 32-bit Wine prefix 0x0066ff30 proved stable across separate
  processes (ten independent runs). It would differ on a host whose stack lands
  elsewhere, so the keygen exposes the tail bytes as a parameter.

  A name of ten or more characters overwrites both bytes itself via the
  cin >> into char[8] overflow, making those serials independent of the stack
  address and portable. Verified: 10-char names accept as predicted, and the
  program still exits cleanly because the corruption stops short of the return
  address at [ebp+4].

VERIFICATION
  10 predicted serials accepted (lengths 1 through 10), 3 rejected: an
  off-by-one serial, zero, and a serial valid for a different username. Each in
  its own process.

DEAD ENDS AND MISSTEPS
  - Assumed from the strings output that "serial:(0,3)" meant a substring
    range (0,3). It is debug metadata. Reading the section list first would
    have avoided the assumption entirely.
  - pkill -f 'Nicohogtag' killed the shell that ran it, because the pattern
    appeared in that command's own argv. Returned exit -15 with no other
    symptom. Put the target name in a script and match on a fragment that is
    not in the caller's command line.
  - lab_r2 merged stderr into stdout, so r2's per-function "Function already
    defined" commentary buried the answer. r2's noise is all on stderr and is
    not gated by log.level; keep stdout, retain stderr only as a fallback for
    the empty-stdout case.
