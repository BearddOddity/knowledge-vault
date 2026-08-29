<!-- summary: Took an Xbox game binary from 714 named functions to 4,560 and split its 15,742 functions into platform, engine and game code, using RTTI vtable walking plus cross-binary hash comparison against four related builds. -->
# X-Men Legends (Xbox) analysis campaign

**Technique:** RTTI vtable walking supplied the overwhelming majority of names. Cross-binary FID-hash comparison against the same game on another platform pinned the platform layer exactly. Xbox SDK support was built up first: an XBE loader, a signature database, and SDK headers parsed into data types.

## Notes

TARGET
  X-Men Legends, original Xbox, default.xbe, image base 0x00010000.
  XDK build 5849. Engine: Intrinsic Alchemy plus Raven's own framework
  (ratl template library, CEntityFactory/CActor/CAI* entity system).
  Analysed inside a Kali WSL lab via a Ghidra project moved from Windows.

OUTCOME

  functions           14,824 -> 17,308   (RTTI found 2,484 never recognised as code)
  named functions        714 ->  4,560
  data types              97 ->  2,161

  15,742 hashed functions classified:
    Xbox platform (XDK/CRT)                 7,815   49%
    game - unique to this title             5,557   35%
    engine (cross-game, cross-platform)     1,496    9%
    X-Men portable code                       730    4%
    X-Men series only                         144   <1%

  The recompilation's real surface is about 6,400 functions, not 14,000. The
  7,815 platform functions are the ones to replace with real Win32/CRT rather
  than recompile.

WHAT WORKED, IN ORDER OF VALUE

  1. RTTI vtable walking - 3,748 names in one pass. Ghidra's RTTI analyzer is
     PE-only so it never ran on an XBE, and the data was sitting there unused.
     See the naming-a-large-game-binary-at-scale pattern.
  2. The same game on two platforms - Marvel: Ultimate Alliance on Xbox versus
     its 2006 PC build defined the Xbox platform layer by construction rather
     than by inference.
  3. SDK data types - 2,084 types parsed from the Xbox headers, then joined to
     the signature database's names to give 142 functions real prototypes.
     Neither alone was much use; a name still decompiles with undefined4
     parameters and a prototype with no address has nothing to bind to.

WHAT DID NOT WORK, AND WHY IT IS WORTH KNOWING

  - Cross-binary name transfer from two other titles carrying 8,533 and 6,384
    RTTI names produced FOUR names. Not ambiguity: 6,277 of the target's
    unnamed functions have a counterpart that is also unnamed, because both
    sides were named the same way and are blind in the same place - non-virtual
    functions. Acquiring more binaries will not help naming.
  - Function ID: Ghidra ships the engine and no .fidb data at all, and there is
    no source of MSVC CRT names in this toolchain - no XDK .lib files exist and
    the project's own CRT identifier has 9 hand-written patterns. FID moved
    671 known names between titles; it cannot invent the CRT.
  - Class::Method strings: only 4 in one build, and no __FILE__ source paths at
    all. A thin seam, not the goldmine it looked like.

MISTAKES MADE

  - Named 52 of 266 classes wrongly by reversing template mangling on '@'.
    ".?AV?$handle_str@...@ratl@@" became "$0A::V?$handle_str::?$map_vs" - a
    name that looks demangled and is not. Wrong-but-plausible is worse than
    ugly: everything downstream trusts it. Templates now keep a sanitised raw
    form, and the corrector had to accept the bad pattern explicitly or it
    would skip them for no longer being FUN_.
  - Concluded "shared between the two X-Men titles = engine" without checking.
    A third title showed 34 of 664 shared classes are series-specific. The
    original estimate survived, but it was luck rather than method.
  - Wrote the XBE library-version parser against wrong header offsets and got
    convincing garbage back (library names of random bytes, build numbers in
    the tens of thousands). Correct offsets: count 0x160, address 0x164.
  - Killed Ghidra with `xdotool windowkill`, which destroys the X client and
    takes the JVM with it.
  - Built the RTTI walker with a per-class memory scan. Quadratic; produced
    nothing in two minutes before being rewritten around a single index.

WHAT REMAINS
  3,866 unnamed functions on the game surface. RTTI cannot reach them because
  they are not virtual. The routes that can: diagnostic string
  cross-references, call-graph propagation from the 4,560 named functions, and
  Alchemy's own ig* type-registration table, which names constructors and
  factories.
