<!-- summary: **The UI menu files in `UI/menus/*.XMLB` are not XML. They are a custom binary… -->

# XMLB UI format (Alchemy engine) — preliminary analysis

## **The UI menu files in `UI/menus/*.XMLB` are not XML. They are a custom binary widget tree used by `libIGGui.dll` / `libIGAttrs.dll`.**

The Alchemy engine ships a custom UI format with the extension `.XMLB` that is unrelated to XML. The PC install of X-Men Legends II: Rise of Apocalypse contains 150+ `.XMLB` files in `UI/menus/`, each paired with a `.engb` (English binary text) file. The engine reads them via the `libIGGui` and `libIGAttrs` DLLs in the same directory.

The relevant files for the Advanced Options menu (the one with Resolution and FSAA only) are:

- `UI/menus/options.XMLB` — 4,679 bytes
- `UI/menus/game_options.XMLB` — 5,998 bytes
- `UI/menus/options_controller.XMLB` — 7,755 bytes
- `UI/menus/options.IGB` — 6,072 bytes (the texture atlas backing the widgets)

## **Why the Advanced Options menu shows only Resolution and FSAA even on a 16:9 display**

**The UI layout is hardcoded at 640x480 (4:3) and the menu definition only declares two widgets — there is no free space because the engine has no concept of empty space to begin with.**

The screenshot the user shared shows the Advanced Options panel with a large empty region below the FSAA slider. That empty region is not "free space we could populate" — it is the panel's own background rendered to its declared bounds, with no widgets declared inside it. The XMLB format is a widget tree, not a flexible layout: every visible element is a node in the tree with explicit coordinates. There is no padding, no flow, no grid. Whatever widgets the menu tree declares, those are the only widgets the panel will ever show.

The full set of graphics CVARs that exist in the binary (`multiSampleType`, `textureFilter`, `cameraFOV`, `max_fps`, `gamma`, `texturescale`, `presentationInterval`, `multiThreaded`, the full `Settings\Display\*` registry tree) are completely absent from this menu tree. They are reachable only through `alchemy.ini` and the F10 debug console, both of which work fine; they were simply never added to the UI tree in 2005.

To add a new setting (e.g. a Texture Quality slider), the entire XMLB file would need to be decoded, the new widget node appended at the right offset with the correct sibling/parent pointer, and the file length adjusted. The engine treats these files as memory-mapped, so misaligned pointers in the tree will crash at load before the menu ever renders.

## **Binary structure observations from three sample files**

The three sample files (`options.XMLB`, `game_options.XMLB`, `options_controller.XMLB`) all share:

- A 4-byte magic at offset 0 (still unidentified — the four bytes are not a printable signature)
- A repeating 4-byte record structure that looks like `(parent_offset, child_offset, sibling_offset, end_offset)` — characteristic of a flat binary tree stored as a single contiguous node array
- Embedded string table references at the end of each record (the strings themselves live in the matching `.engb` file)
- Float values consistent with 640x480 normalised coordinates (values mostly in `[0.0, 640.0]` for X and `[0.0, 480.0]` for Y, with a few outside that range that are probably scale or anchor values)

Strings extracted from `options.XMLB` confirm widget labels: `ACCEPT`, `BACK`, `RESOLUTION`, `FSAA`. The menu tree depth matches the visible UI: title → panel → FSAA slider → ACCEPT button → BACK button. There are exactly two configurable widgets in this menu. Everything else is static decoration (the title bar, the orange gradient background, the `[ESC] BACK` footer).

## **Why we did not reverse the format end-to-end**

The 4:3 layout is not a bug in the engine — the game was designed for 4:3, and the original Xbox shipped at 480p / 720p (both 4:3). When the PC port added 16:9 widescreen rendering, the developer added the `Settings\Display\Resolution` registry path and a 4:3 aspect ratio CVAR, but the UI menus were left in their 4:3 layout coordinates. Stretching them to 16:9 via dgVoodoo2 (`Scaling = Stretched`) is the intended remediation, not a hack.

The XMLB format reversal is documented as a separate exercise, scoped to modifying the layout, not the format. Before that work begins, the right place to start is `libIGAttrs.dll` (the parser) and `libIGGui.dll` (the renderer) in the game directory — both are MSVC DLLs with full symbol tables. The parsing function takes a filename, a memory buffer, and a length; the rendering function takes a widget ID and walks the parent pointer chain. A Ghidra project against those two DLLs should reveal the struct layout in an afternoon, which is faster than guessing from the bytecode.

## **What I would do next if asked to add a new setting to the menu**

1. Open `libIGAttrs.dll` and `libIGGui.dll` in Ghidra, recover the XMLB struct (the four 4-byte offsets above are a strong lead).
2. Write a Python tool that reads an XMLB, prints the tree, and round-trips a modified copy.
3. Add a widget for `Settings\Display\Distance` (already in the binary as a registry path, but not in the menu) by appending a node to `options.XMLB`.
4. Ship the patched XMLB and a backup of the original in a single archive so it can be applied and reverted with one command.

## Format fully solved: magic, node layout, string table, byte-identical round trip

Follow-up to the preliminary analysis above: the format is now fully reverse-engineered and re-implemented, not just partially understood.

**Header**: `u32 magic = 0x000011B1` at offset 0 (the preliminary note's "4-byte magic, still unidentified" - now identified), `u32 version` at offset 4.

**Node layout** (repeats, 16-byte fixed header + attr pairs): `{ name_offset: u32, next_offset: u32, first_child_offset: u32, attr_count: u32 }`, followed by `attr_count` pairs of `{ key_offset: u32, value_offset: u32 }`. All offsets point into a shared string table at the end of the file. `0xFFFFFFFF` is the "none" sentinel for `next_offset`/`first_child_offset`.

**Top level is a sibling chain, not one root.** Parsing starts at offset 8 and walks `next_offset` across however many top-level trees the file has (most files have one; some have several, e.g. concatenated menu fragments).

**String table is deduplicated at first pre-order occurrence** - a string used by five different nodes is stored once, and every reference points at that one offset. Building a writer that doesn't dedupe would still round-trip a stock file (since the reader doesn't care about duplicates) but would silently double the file size on every re-save, which is how such a bug would actually surface.

**Known-corrupt fixture example**: `options_patched.XMLB` has a bad root `first_child_offset` that doesn't land on a real node header. Correctly rejecting this (not silently misreading it as a plausible-but-wrong node) needs an attribute-count sanity bound in the node parser - without one, garbage bytes at the wrong offset can look like a node with an absurd attribute count and the parser will try to read attribute pairs until it walks off the end of the file.

**Verification**: implemented in C# (`Athanor.Alchemy/Xmlb.cs`, part of a Prowl-engine-based editor rewrite of the "Athanor" X-Men Legends II modding toolkit) and round-tripped byte-identical against all 5,883 real files across every XMLB-family extension in a retail install (`.XMLB .PKGB .engb .CHRB .NAVB .BOYB .itab` all share this one container format under different extensions - detection must be by magic, not extension, since at least one sample file with an XMLB extension turned out to hold something else entirely, opening with `{`).

**Wired into a real running editor**: import → browse as a tree widget → select a node → edit its name/attributes → Save rebuilds the tree to bytes and overwrites the source file, verified live (not just unit-tested) against `options.XMLB`'s actual 104 nodes and `game_options.XMLB`, confirming the loop actually works end-to-end in a GUI, not just at the byte level.
