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
