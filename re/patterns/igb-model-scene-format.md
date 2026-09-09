<!-- summary: Header, meta-field table, class table, and object directory (Alchemy IGB) -->
# igb-model-scene-format

## Header, meta-field table, class table, and object directory (Alchemy IGB)

IGB (Intrinsic Graphics Binary) is Alchemy's model/texture/animation/scene container - the bulk of an X-Men Legends II install (4,886 files). It is not an asset container in the usual sense: it's a serialisation of Alchemy's own object system, so **every file carries its own schema** (a class table) ahead of its data.

**Header** (`igIGBFile`'s own getters, from `libIGCore.dll`):
```
0x00 u32 entryBufferSize    0x04 u32 entryCount
0x08 u32 metaObjectBufferSize 0x0C u32 metaObjectCount
0x10 u32 objectBufferSize   0x14 u32 objectCount
0x18 u32 memoryBufferSize   0x1C u32 memoryRefCount
0x20 u32 metaFieldBufferSize 0x24 u32 metaFieldCount
0x28 u32 magicCookie = 0x0000FADA   0x2C u32 magicVersion
```
Identify by `magicCookie` at `+0x28`, never by the first word (a section size, not a magic - it differs per file). `magicVersion` is `0xF0000006` across a whole X-Men Legends II install and `0xB0000006` in a handful of older files. Confirmed byte-for-byte by decompiling `igIGBFile::readHeader` itself: it copies these twelve header words straight into named struct fields with no reinterpretation, so every downstream field name is verified, not inferred.

**Meta-field table**: `metaFieldCount` records of 12 bytes `(name_length, 1, 0)`, then a pool of that many NUL-terminated names (`igIntMetaField`, `igObjectRefMetaField`, `igMemoryRefMetaField`, ...). Lengths chain exactly onto the pool.

**Data-section names**: `(a, b, count)`, then `count` u32 lengths, then the names (`VertexArrayData`, `ImageData`, `VertexData`).

**Class table**: `metaObjectCount` records of 24 bytes: `name_length(padded to even), 1, 0, own_field_count, parent_class_index(0xFFFFFFFF for the root), total_field_count(including inherited)`. **The critical gotcha**: the pool that follows is not a plain name list - each class contributes its name, then its own `own_field_count` field descriptors as `(u16, u16, u16)` triples inline, so entry N occupies `name_length + own_field_count * 6` bytes. Reading it as names-only desyncs at the second class that declares any field. `igObject` is always index 0 with no parent - a cheap "did the walk land correctly" check.

**Field descriptor** triple: `(meta_field_index, slot, size_in_bytes)`. `meta_field_index` recovers the field's type via the meta-field table. Slots start at 2 (the first two belong to the object header). **Fields are keyed by slot, and a subclass redeclaring a slot replaces its parent's rather than appending** - this is why e.g. `igObjectList` declares 3 fields of its own but reports `total_field_count = 5`, not 8: to get an object's real, live field set you must walk the class hierarchy base-to-derived building a slot->field map, letting later (more derived) declarations overwrite earlier ones.

**Object directory**: two self-sized blocks (a pool name, a memory-pool name list) then the directory. Header section 0 (`entryBufferSize`/`entryCount`) gives its total byte size and entry count - check both against the walk and drop the directory rather than trust it on disagreement. Each entry leads with `(kind, byte_size, 0)`: kind 3 is `igObjectDirEntry` (payload: class index, memory-pool handle, 20 bytes total), kind 4 is `igMemoryDirEntry` (payload: `_memSize, _memTypeSize, _memTypeIndex, _refCounted, ...`, 32 bytes total). A kind-4 entry's on-disk record is only its own 32-byte metadata - the actual referenced bytes (geometry, pixels) live elsewhere, addressed separately.

**Verification**: ported to C# (`Athanor.Alchemy/Igb.cs`), parses 4,885 of 4,886 real files in an X-Men Legends II install. The one failure, `Models/Weapons/tank_turret.IGB`, is a genuinely truncated file in the retail install (confirmed, not assumed: its class table's last name is cut off mid-string at the exact 4,096-byte file boundary - `...igNode\0\0...ig` then EOF) - a format-conforming parser should reject it, not a parser bug to chase.
