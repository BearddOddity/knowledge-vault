# xml2-pc-oracle

## **A sibling PC build with RTTI names 880 classes, but its v…

**A sibling PC build with RTTI names 880 classes, but its vtable slot indices transfer for only half of the shared ones.**

X-Men Legends II for PC (`XMen2.exe`, MSVC 7.10, timestamped 2005-09-08, 3,129,344 bytes, image base 0x00400000, `.text` 0x00401000 + 2,611,125 bytes) is the same Intrinsic Alchemy codebase as the Xbox X-Men Legends target, compiled for Win32 with RTTI left in. `tools/rtti/xml2_pc.py` walks it and recovers 1,058 type descriptors, 1,763 complete object locators and **880 classes with vtables** — including Alchemy internals the game's own registry does not name, such as `CAlchemyObjectPool<...>` instantiations and the `Rascl::` run-handler structs.

The extraction walks the MSVC RTTI chain backwards, because the names are the only part findable without already knowing where anything is: find `.?AV`/`.?AU` name strings, subtract 8 to get each TypeDescriptor, find the dwords pointing at those to get each RTTICompleteObjectLocator (pTypeDescriptor sits at COL+12, and the 32-bit signature field is 0), then find the dwords pointing at each locator — a vtable starts 4 bytes after its own locator reference, since the locator lives at `vtable[-1]`. Slot counting stops at the first dword that is not inside `.text`. A class with several bases has one vtable per base; keeping the widest gives the complete object's own table.

**The caveat is the useful half of the result.** XML2 is a LATER engine revision than XML1. Of the **412 class names the two binaries share, only 193 have the same vtable slot count**. `CGame` has 110 virtuals on Xbox and 162 on PC; `CMenuMgr` 99 against 156; `CActor` 126 against 137; the whole `CPhysicalEntity` family gains five. So a slot INDEX taken from XML2 is sound only for a class whose slot count matches — for the other 219 it will name the wrong method while looking perfectly plausible. `build/xml1_xml2_class_map.json` records both counts and a `slots_match` flag per class so that check costs nothing.

Worked example of the caveat biting: chasing a crash on a `call [vtable+0xCC]` (slot 51), 56 XML1 classes are wide enough to reach that slot, but only four of them — `CActionEntity`, `CLightEntity`, `CPlayerStartEntity`, `CWaypointEntity` — share a slot count with their XML2 counterparts. In XML2 all four inherit the same implementation at slot 51, `0x00419F10`, which is two instructions: `mov dword ptr [ecx+0x90], 0; ret`. It takes no argument, while the XML1 call site passes one — so the XML1 class is not in that family and the slot number could not be transferred. The map said as much before the disassembly did.

Two copies exist: `X-Men-Legends-II-Rise-of-Apocalypse_NoCD_Win_EN/XMen2.exe` is a **NoCD-patched** binary, fine for structure and RTTI but not byte-identical to retail, and `x-men-legends-ii-rise-of-apocalypse_202310/` holds the original ISO for anything where that distinction matters.

Usage:

    py -3 tools/rtti/xml2_pc.py <XMen2.exe> -o build/xml2_rtti.json \
        --compare build/rtti.json --map-out build/xml1_xml2_class_map.json
