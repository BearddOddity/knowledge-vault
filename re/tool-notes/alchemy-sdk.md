# alchemy-sdk

## **The Alchemy 5.0 SDK's `.igo` files are the authority on I…

**The Alchemy 5.0 SDK's `.igo` files are the authority on IGB object layout — reach for them before reverse-engineering field offsets by hand.**

An extracted Alchemy 5.0 evaluation install sits at `D:/re-lab-share/AlchemyExtracted/`. The parts that matter for decoding IGB:

- `include/**/*.igo` — object definition files. Each declares a class's fields **in serialisation order**. `include/igGfx/igImage.igo` declares exactly 21 fields, matching the `own_fields = 21` an IGB's own class table reports for `igImage`. Extract them with `grep -oP '\(field\s+\K\S+'`.
- `include/igGfx/igGfx.h` — the `IG_GFX_TEXTURE_FORMAT` enum: `RGB_DXT1 = 13`, `RGBA_DXT1 = 14`, `RGBA_DXT3 = 15`, `RGBA_DXT5 = 16`, `RGBA_8888_32 = 7`.
- `bin/igbTypes.exe`, `bin/sgOptimizer.exe`, `ArtistPack/Finalizer/sgFinalizer.exe`, `ArtistPack/insight/DX9/insight.exe` — SDK tools that read IGB directly. Not yet used; a disassembly of these would settle anything the headers leave open.
- `DirectX9/lib/libIGInsight.dll` — also ships with the retail game at `D:/My Games/X-Men Legends II Rise of Apocalypse/libIGInsight.dll`.

The `igImage` field order, which maps straight onto the serialised record: `_px`, `_py`, `_pz`, `_orderPreservation`, `_order`, `_bitsRed/Grn/Blu/Alpha`, `_pfmt`, `_imageSize`, `_pImage`, `_pName`, `_localImage`, `_bitsInt`, `_pClut`, `_bitsIdx`, `_bytesPerRow`, `_compressed`, `_bitsDepth`, `_pNameString`. With all fields 4 bytes except the two bools, `_pfmt` lands at +36 from `_px` and `_imageSize` at +40.

**Why this was worth finding.** X-Men Legends II stores 433 of 442 sampled images as **DXT3**, not DXT5. Both are 16 bytes per block and share an identical colour half, so no size arithmetic distinguishes them — only `_pfmt` does. Inferring the format from block size decodes every texture in the game with the wrong alpha while the colour comes out right, so the images look plausible and nothing fails. The SDK header is what turns that from a guess into a reading.

A useful corroboration once the record is located: `_imageSize` must equal what `_pfmt` needs for `_px × _py`. Two independently stored numbers agreeing to the byte is strong evidence the record was found correctly.

## **Disassembling `libIGCore.dll` named the whole IGB header…

**Disassembling `libIGCore.dll` named the whole IGB header and settled two long-running questions — reach for the exported symbols before decompiling anything.**

The DLL is MSVC-compiled with decorated names intact. `is~<name>` in radare2 resolves any method directly; no Ghidra project needed.

**The header, from `igIGBFile`'s exported getters.** The class declares one getter per header word (`getEntryCount`, `getMetaObjectBufferSize`, `getMemoryRefCount`, `getMagicCookie`, ...), which maps the header outright:

```
0x00 entryBufferSize        0x04 entryCount
0x08 metaObjectBufferSize   0x0C metaObjectCount
0x10 objectBufferSize       0x14 objectCount
0x18 memoryBufferSize       0x1C memoryRefCount
0x20 metaFieldBufferSize    0x24 metaFieldCount
0x28 magicCookie = 0xFADA   0x2C magicVersion
```

Two corrections fell out of this. `0x20` is **not** a version — it is the byte size of the meta-field section, which is why it looks constant at 1587 (47 entries) and 1485 in older files with 44. It equals the walked section size in 500/500 files. And `0x2C` is `magicVersion` (0xF0000006 in X-Men Legends II, 0xB0000006 in older files), not flags.

**Block layout, from `readMemoryRefBuffer` @ 0x10026530 and `igMemoryDirEntry::readMemorySpecial` @ 0x10027280.** The reader walks every directory entry in order calling the virtual `readMemorySpecial`; the memory subclass streams its block and ends with `add eax,3 / and eax,0xFFFFFFFC` — blocks are **4-byte aligned**.

**Still unsolved:** the order blocks are *written* in. Directory order does not match file order (`greenglow.IGB` lists `[4096, 4]` but writes the 4-byte block first), and `8 + aligned(others) + image == region` closes for only 64 of 536 files. `writeMemoryRefBuffer` / `writeCreateAndFillEntryBuffer` is where that rule lives.

**A trap worth remembering.** Reading a DXT3 block a few bytes early does not fail — it slides the alpha half into the colour endpoints, and since opaque alpha is `0xFF` nibbles, `0xFFFF` in RGB565 decodes as **white**. A wrong offset yields a confident, plausible, wrong image. Colour-named textures (`greenglow`, `blueglow`, `bluegrad`) make cheap oracles: if `greenglow` is not green, the offset is wrong.

**MUA1 `.sis` sound cues** (12,356 files), cracked from the data alone and verified 4000/4000:

```
0x00 "0SIS"   0x04 u16 first-record offset   0x06 u16 path length
0x08 u16 record count   0x0A u16   0x0C u16 0x7F00   0x0E u8 0xF4
0x0F path, NUL-terminated
then `count` records: +0x00 u16 record length, +0x02 u16 name length,
                      +0x04 u8[3], +0x07 name
```

A cue names a logical sound and lists the sample variants the engine picks between (`material/footstep/fs_grass` → `grass2_1`, `fs_grass4_2`, `fs_grass8_2`). The records tile the file exactly, which is the check that the walk landed. The cues live beside `.fsb` FMOD banks inside directories named `*.pak` — those are **folders, not archives**, which is easy to waste time on.
