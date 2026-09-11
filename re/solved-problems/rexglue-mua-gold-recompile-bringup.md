<!-- summary: Windows ReXGlue toolchain bring-up + first boot of a static-recompiled Marvel Ultimate Alliance Gold Edition (X360 -> PC); blocked on the game's packed asset archive (assetsfb.wad) -->
# rexglue-mua-gold-recompile-bringup

**Technique:** Fresh recursive git clone (unpacked SDK tarball has no submodule metadata) + build inside vcvars64 (bare clang/clang++ presets can't see Windows SDK libs otherwise) + iterative function-boundary hinting in the manifest TOML, each hint found by scraping the runtime's own fatal-guest-address log line

## Notes

## Goal
Port Marvel Ultimate Alliance **Gold Edition** (Xbox 360, Title ID 415607DA) to native PC with ReXGlue 0.10.0, because the 2016 "Zoe Mode" PC re-release is badly made. Confirmed early: the Gold-exclusive content (extra roster + costumes) is **data-only** — `muadlc_titleupdate/` overrides data files (herostat.xmlb etc), `muadlc_content/` adds character `.igb` models — no XEX patch. Same `default.xex` either way, so an in-game "enable Gold DLC" toggle is architecturally sound once the base title boots (mount composition, no exe patching needed).

## Windows toolchain bring-up
- The unpacked SDK folder (`rexglue-sdk-0.10.0.zip` extracted) has **no git metadata**, so `thirdparty/*` submodules can't resolve locally. Fix: fresh `git clone --recursive --depth 1 --branch v0.10.0 --shallow-submodules` elsewhere; don't try to build in the unpacked tarball.
- CMake presets (`win-amd64`) call bare `clang`/`clang++` (GNU driver, `-march=x86-64-v2`, C++23, Ninja Multi-Config) — **not** MSVC `cl`, and not `clang-cl`. Install standalone LLVM (`winget install --id LLVM.LLVM`; gets you `C:\Program Files\LLVM\bin`, not on PATH by default).
- Clang still needs an MSVC STL + Windows SDK (`kernel32.lib` etc.) even though it's not `cl` — **must configure and build from inside `vcvars64.bat`** (`...\VC\Auxiliary\Build\vcvars64.bat`) or you get `lld-link: error: could not open 'kernel32.lib'`. A bare-shell `cmake --preset win-amd64` fails that way even with LLVM and the Windows SDK both present.
- `thirdparty/libmspack`'s `cabextract/mspack/*` (14 files: cab.h, cabd.c, lzx.h, lzxd.c, macros.h, mspack.h, mszip.h, mszipd.c, qtm.h, qtmd.c, readbits.h, readhuff.h, system.c, system.h) are **git symlinks**. Windows checkout without Developer Mode materializes them as 1-line text files containing the relative target path instead of real symlinks, which fails as `error: expected identifier or '('` on the literal path text. Fix: `cp` the real file (`../../libmspack/mspack/<name>`) over each stub. (MoltenVK also ships git-symlinks but doesn't matter on a Windows/D3D12 build.)
- SDK builds clean after that: `cmake --preset win-amd64` then `cmake --build --preset win-amd64-release --target rexglue`.

## Project SDK bug found: rex::runtime doesn't propagate imgui includes
A consumer app that only links `rex::runtime` (as `rexglue_setup_target()` in a generated project's CMakeLists does) fails with `fatal error: 'imgui.h' file not found` compiling `rex/rex_app.h` (a *public* SDK header that pulls in `rex/ui/imgui_dialog.h`). Root cause: `src/kernel/CMakeLists.txt` links `rexui`/`imgui` into `rexruntime` as **PRIVATE**, so the PUBLIC include dirs `rexui` exports don't reach the consumer. Workaround in the generated project (not the SDK): also `target_link_libraries(<app> PRIVATE rex::ui)` after `rexglue_setup_target()`.

## The codegen/build/run/fix loop
`rexglue codegen` validates every static branch resolves to a known function. First run on MUA Gold's `default.xex`: 12 `UnresolvedCall` errors, all unconditional `b` to addresses "not in any function" — every one was a **no-return function only reached via an indirect/vtable call**, invisible to the vtable scanner because... [same class the vault's `code-a-disassembler-never-turned-into-a-function.md` pattern already covers, cf.]. Fix: add each address to `[entrypoint.functions]` in the manifest TOML. Two size strategies both worked:
- Explicit `{ size = 0xNN }` (works even if slightly generous — the analyzer logs `[functions] 0xADDR size 0xNN split by vtable entry point 0xADDR2` and self-corrects the boundary).
- `{}` (empty table = size 0) — CONFIG-authority functions with no declared size fall through to normal block discovery (`phase_discover.cpp`: "let discovery find natural boundaries via region"), so this is the lazier default; use it unless you already know the exact extent.

After codegen succeeds, the **same pattern recurs at runtime**: `rexruntime`'s function dispatcher logs `[FATAL] Call to invalid or unregistered function at guest address 0xADDR` for any indirect-call target codegen didn't know to make a function (jump-table targets, un-scanned vtable slots, etc — codegen's static analysis and the runtime's actual execution trace disagree). This is a **build → run → read log → add hint → rebuild** loop, not a one-shot fix. Automated it as a bash script: run the exe with a timeout, `grep` the newest log for `unregistered function at guest address 0x[0-9A-F]+`, append `0xADDR = {}` to the manifest, re-run `rexglue codegen --ignore-stamp` + incremental rebuild, repeat; stop if the same address recurs (means it needs a real fix, not just a hint) or no fatal-address pattern is found (progressed past that class of bug). 8 rounds (6 automated + 2 manual) took MUA Gold from "won't validate" to "runs past every crash-on-call fault."

## GPU plugin wiring
`rexglue_setup_target(<target> GPU_PLUGINS xenos)` in the project's CMakeLists stages `rexgpu-xenos.dll` next to the exe and makes the target depend on it, but does **not** select it at runtime — the runtime reads the `gpu_plugin` cvar (default empty = no GPU). Force it in the app's `ReXApp` subclass:
```cpp
void OnPreSetup(rex::RuntimeConfig& config) override {
  if (config.gpu_plugin.empty()) config.gpu_plugin = "xenos";
}
```
(`OnPreSetup` fires after the cvar is read into `config_` and before the plugin actually loads, so overriding here beats a CLI default while still letting `--gpu_plugin` on the command line win.)

## Current wall: the game's own packed asset archive
With all crash-on-call faults fixed and GPU (D3D12 on the host's AMD RX 7600 XT) + audio both initializing, the game plays audio but shows a **black screen**. Root cause is visible in the runtime log, not a recompiler bug:
```
[NtCreateFile] FAILED: path='D:\z\assetsfb.wad' -> 0xc000000f
[fs] VFS: '' -> [no device]
[fs] ResolvePath() failed - device not found
```
followed by ~30s of `Texture fetch constant ... "invalid" type!` GPU spam (drawing with unset textures) and then a clean guest-initiated `Title terminated; hard-exiting process` — not a crash, the title's own asset-load failure path.

The distributed game files include `z/assetsfb.zip` (1186 files / 4.6 GB unpacked: `actors/ data/ effects/ movies/ packages/ scripts/ shaders/ sounds/ textures/ ui/`) but **not** the `.wad` container itself. `packages/generated/*.fb` files are package *descriptors* (each is a list of filename strings, fixed-size records, no payload — e.g. starts `textures/glow.igb\0\0\0...`), not the packed data. Extracting the zip to the game root fed the engine its `data/` config (roster, strings) enough to get past the `[functions]` hint stage, but the engine's texture/model/shader loader specifically wants the `.wad`, not loose files at the root — `--gpu_allow_invalid_fetch_constants=true` and relocating the loose tree didn't change the outcome.

**Not yet solved: reconstructing/synthesizing `assetsfb.wad`**, or finding the Raven Alchemy engine's loose-file boot mode (check `alchemy.ini`/`build.ini` for a dev/loose flag). This is Alchemy-engine-specific knowledge, likely documented in MUA modding circles (Marvel Mods forum), not general ReXGlue knowledge. Candidate next probes: a minimal/empty `assetsfb.wad` (test whether asset-path derivation just needs the open to succeed), loose tree under `z/` or `z/assetsfb/` instead of game root, or a VFS shim in the app that intercepts the guest's `assetsfb.wad` open and serves the loose tree directly.

## Environment specifics (this machine)
Standalone LLVM 22.1.8, VS "18" Community (VS2026 preview) providing MSVC 14.51.36231 + Windows SDK 10.0.26100/10.0.28000, Vulkan SDK 1.4.357.0 (unused by this build — `win-amd64` preset builds D3D12=ON, Vulkan=OFF). SDK clone at `D:\My apps\rexglue-sdk`; port project at `D:\My apps\mua-port` (created via `rexglue init --project-name mua --xex-path <default.xex> --game-root <game dir> --scan-dll`); game files at `D:\My Games\Marvel Ultimate Alliance Gold Edition X360`.
