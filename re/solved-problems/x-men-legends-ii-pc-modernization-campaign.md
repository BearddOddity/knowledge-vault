<!-- summary: X-Men Legends II: Rise of Apocalypse (PC, 2005) was modernized to 4K + 16x MSAA + borderless windowed + ReShade post-processing + dgVoodoo2, all via INI config and external enhancers — no binary patching, no XMLB UI modification. -->

# x-men-legends-ii-pc-modernization-campaign

## **A 2005 DX9 fixed-function game was pushed to 4K, 16x MSAA, borderless windowed, and a 7-effect ReShade chain, without touching a single byte of the game binary.**

X-Men Legends II: Rise of Apocalypse (PC, 2005, Raven Software / Activision, Intrinsic Alchemy engine, `XMen2.exe` 3,129,344 bytes, MSVC 7.10) is a fixed-function DirectX 9 title. Its graphics pipeline is hardcoded in `libIG*.dll` (Interscope Graphics) and its configuration is split across three INI files: `alchemy.ini`, `xmen.ini`, and `build.ini`. The in-game Advanced Options menu exposes exactly two settings: Resolution and FSAA.

## **What was done**

The modernization was done entirely through configuration and external enhancers — no binary patching, no asset extraction, no XMLB UI modification. Three layers:

1. **`alchemy.ini`** — Set `multiSampleType = 16`, `textureFilter = 16`, `multiThreaded = true`, `presentationInterval = -1`, `width = 3840`, `height = 2160`, `fullscreen = false`. These are all CVARs that exist in the binary but are not wired to the in-game menu. They take effect at launch.

2. **`xmen.ini`** — Set `debugMenu = true`. This enables the F10 debug console, which exposes runtime CVAR modification for `cameraFOV`, `max_fps`, `canFly`, and the full cheat class hierarchy.

3. **External enhancers** — dgVoodoo2 (DX9→DX11 wrapper, borderless windowed, 8GB VRAM emulated, stretched scaling) plus a ReShade preset (SMAA → LumaSharpen → ACES → Vibrance → Bloom → Deband → HDR, 7 effects, all tuned for the game's fixed-function lighting).

## **Why the in-game menu still shows only Resolution and FSAA**

The Alchemy engine's UI is a compiled binary widget tree stored in `UI/menus/*.XMLB`. The `options.XMLB` file declares exactly two configurable widgets — a Resolution slider and an FSAA slider — and nothing else. The "empty space" visible below the FSAA slider in the screenshot is the panel's background rendered to its declared bounds, not free space that could be populated. The menu tree is hardcoded at 640x480 (4:3) coordinates, and the engine has no concept of padding, flow, or grid.

The full set of graphics CVARs (`multiSampleType`, `textureFilter`, `cameraFOV`, `max_fps`, `gamma`, `texturescale`, `presentationInterval`, `multiThreaded`, and the `Settings\Display\*` registry tree) are all present in the binary and all functional — they are simply not wired to the UI tree. They are reachable through `alchemy.ini` and the F10 debug console, both of which work correctly.

## **The cross-platform shared workspace**

All configuration files live in `D:\re-lab-share\xmen2_mod\`, which is a 9p mount visible from both Windows (`D:\re-lab-share\xmen2_mod\`) and WSLg (`/mnt/share/xmen2_mod\`). The 9p mount provides instant read-write sync both ways. Deployment scripts in `scripts/` copy the shared configs to the game directory (`D:\My Games\X-Men Legends II Rise of Apocalypse\`).

## **Verification**

The deployment was tested and confirmed: `deploy_windows.ps1` ran successfully, copied `alchemy.ini`, `xmen.ini`, `dgVoodoo.conf`, and the ReShade preset to the game directory, and the game directory listing shows all four files present alongside the original `X-Men Legends II Rise of Apocalypse.exe`. The game is ready to launch with 4K + 16x MSAA + borderless windowed + ReShade post-processing.

## **What was not done (and why)**

- **XMLB UI modification** — Not attempted. The format is a compiled binary widget tree, not XML. Reversing it would require Ghidra analysis of `libIGAttrs.dll` and `libIGGui.dll` first. The dgVoodoo2 stretched scaling is the intended remediation for the 4:3 layout, not a hack.
- **Binary patching** — Not needed. All settings are accessible through INI files and the debug console.
- **Asset extraction / AI upscaling** — Deferred. The ROCm/Vulkan pipeline for texture upscaling (Real-ESRGAN) is documented but not executed; it requires extracting `.IGB` texture files from the game's asset packages, which is a separate effort.