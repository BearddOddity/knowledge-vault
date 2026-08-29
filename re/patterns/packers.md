<!-- summary: UPX with renamed sections, and unpacking by running instead -->
# packers

## UPX with renamed sections, and unpacking by running instead

Renaming a packer's sections is enough to defeat automatic unpacking, and modern UPX will not help you even after you undo it.

**Spotting it:** section names that are not standard (`The`, `man`, `on rc`, `the ack`, `moon` - they spelled a sentence), one section with entropy above 7, a nearly empty import table holding little more than `LoadLibraryA` and `GetProcAddress`, and `VirtualAlloc`/`VirtualProtect` visible in the strings. The UPX copyright string usually survives in the stub:

```
$Id: UPX 0.82 Copyright (C) 1996-1999 Laszlo Molnar & Markus Oberhumer $
```

**Renaming back is not enough.** Setting the sections to UPX0/UPX1/UPX2 got past "not packed by UPX", but then:

```
CantUnpackException: this program is packed with an obsolete version
```

UPX 4.x refuses pre-1.00 formats, and **UPX 3.96 refuses them too** - support was dropped earlier than expected, so chasing older builds is a trap. The pack header for such old versions also does not parse cleanly with modern layouts.

**What works: let the program unpack itself.** A packer is a decompressor; run it and read the result out of memory. Under Wine the target is an ordinary Linux process:

```
dump-wine-image <name> 0x400000 0xC000 out.bin     # /proc/<pid>/mem
fix-dump.py out.bin fixed.exe                      # PointerToRawData = VirtualAddress
```

The fixup matters: on disk a section's bytes live at `PointerToRawData`, in memory at `VirtualAddress`. Load a dump with the original headers and every section lands at the wrong offset, producing disassembly that looks like obfuscation but is just misalignment.

The dumped image is for **analysis only** - the import table holds resolved addresses rather than thunks, so it will not run.

**Order of attack:** if the target refuses to run, fix that first. This binary needed the VB6 runtime before its own unpacking stub ever executed, because Wine's loader failed on the missing DLL before reaching the entry point. No runtime, no self-unpacking, no dump.
