# xemu-oracle

## xemu as a known-good oracle for static recompilation

xemu as a known-good oracle for static recompilation

Source: docs/technical/xemu-debug-plan.md in https://github.com/sp00nznet/burnout3
"Use the running emulator to observe what the game *actually does*, then
reproduce it in our recompiled version."

Why this matters for the X-Men Legends recomp
---------------------------------------------
Every dead end in the 2026-09-04 session came from the same gap: no way to know
what the ORIGINAL does. Ledger #205 ended at "sub_001FE670 must be reached by a
table lookup through a global pointer" and static search could not name the
global, because the base is held in a global and the index is computed at
runtime - there is no literal in the generated C to grep for.

An emulator running the real XBE answers that directly. Break on the guest
address, read the registers and the stack, and the caller and table base are
facts rather than inferences. The same applies to every "why is this function
not called" question, and there have been many.

How
---
1. GDB stub, CPU level:
     xemu.exe -s -S                  # gdb on :1234, paused at startup
     (gdb) target remote localhost:1234
     (gdb) break *0x001FE670
     (gdb) info registers
     (gdb) x/10x <addr>
     (gdb) c
2. QEMU monitor, memory inspection: Ctrl+Alt+2 in the xemu window
     x /10wx 0x557880       examine an object
     x /10i  0x000636D0     disassemble
     screendump frame.png
3. NV2A trace for the GPU command stream:
     xemu.exe --trace "nv2a_pgraph_method"
     or at runtime: trace-event set nv2a_pgraph_method on
4. RenderDoc: xemu has built-in RenderDoc API support for frame capture.

Local setup, verified 2026-09-04
--------------------------------
  xemu:  C:\Users\OddTower\Downloads\xemu-0.8.136-29-gfc13b78060-windows-x86_64\xemu.exe
  BIOS:  D:\Emulation\bios\Xemu\Complex_4627.bin (and v1.03)
  game:  D:\Emulation\roms\xbox\X-Men Legends (World).xiso
  config: C:\Users\OddTower\AppData\Roaming\xemu\xemu\xemu.toml
          renderer = VULKAN, games_dir = D:\Emulation\roms\xbox

Caveat
------
The oracle tells you what the original does. It does NOT tell you whether the
recompiled version is allowed to do the same thing - that still needs the
faithful reading. Use it to replace guesses with observations, not to justify
inventing a check the original never had.
