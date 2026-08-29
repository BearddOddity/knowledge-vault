<!-- summary: One title built for two platforms pins the platform layer exactly; more titles… -->
# Separating engine, platform and game code across binaries

## One title built for two platforms pins the platform layer exactly; more titles on the same engine only refine the engine/game boundary. Match on masked function hashes, never raw bytes.

For a recompilation or a port, knowing WHICH code is the game matters more than
naming it: library and platform code gets replaced with a real implementation
rather than recompiled. This splits a binary without naming anything.

## Match on hashes, not bytes

The same library function links at a different address in each image, so every
absolute operand differs and a raw byte compare finds almost nothing. Ghidra's
FID hash masks the varying operands, which is exactly the question being asked -
"is this the same function as that one, in a different image". Dump
(fullHash, specificHash, address, name) per function and compare sets. Key on
BOTH hashes: the full hash alone collides for very short functions and would
classify unrelated stubs as shared.

## Which extra binary to get, in order of value

1. **The same game on a second platform.** This is the strongest and the least
   obvious. Everything in build A and not in build B of the SAME title is
   platform code by construction - no inference required. Measured: Xbox versus
   PC of one title gave 14,244 platform-only functions against 3,973 portable.
2. **A different game on the same engine.** Separates engine from game logic,
   but only refines - it confirmed an earlier estimate rather than overturning
   it (34 of 664 shared classes turned out to be series-specific, not engine).
3. **A sequel by the same studio.** Weakest: it shares game code as well as
   engine, which is the thing being measured.

Result on a real title, 15,742 functions: 49% platform (SDK/CRT), 35% the game's
own code, 9% cross-platform engine. The recomp's real surface was about 6,400
functions rather than the 14,000 the binary starts with.

## Preconditions to check FIRST, not after

- **Same architecture.** Hashes are instruction bytes. x86-32 and x86-64 share
  nothing, and neither does PowerPC. A console's 360-era or remastered release
  is usually a different architecture and cannot participate at all - one
  remaster here was x64 while every other build was x86.
- **Same SDK build.** Verify rather than assume; it is recorded in the
  container. For XBE: `dwBaseAddr` at 0x104, `dwLibraryVersions` (count) at
  0x160, `dwLibraryVersionsAddr` at 0x164, entries of 16 bytes
  (`char szName[8]; u16 major; u16 minor; u16 build; u16 flags`), header region
  maps 1:1 from file offset 0. All titles compared here reported build 5849 for
  every library including both C runtimes, which is what made the comparison
  sound.
- **Not packed.** A retail PC build may be wrapped in copy protection, in which
  case its code is encrypted and matches nothing. Entropy and string count
  answer it in one step: ~6.4 and 14k strings for a clean build, 7.5+ for
  anything still packed.

## Read a cross-platform bucket as a floor

Two platform builds are separate compilations, so only functions that compiled
identically match at all - one PC build yielded 11,699 hashed functions against
the Xbox build's 19,490. Engine code that simply failed to match lands in the
"platform-only" bucket without being platform-specific. The split is a useful
lower bound on portability, not a measurement of it.

## Class names cross architectures even when hashes cannot

RTTI class names are source-level, so a set comparison works between an x86
build and an x64 remaster where no byte-level method can. Coarser than function
matching - it classifies classes, not functions - but it is the only bridge
across an architecture change, and it agreed with the function-level split.
