<!-- summary: Raven/Alchemy engine's "assetsfb.wad" asset container is a plain ZIP file with the extension renamed — no custom format. -->
# alchemy-engine-assetsfb-wad-is-zip

**Technique:** Header-magic comparison against a known-good reference file from a sibling title

## Notes

Context: ReXGlue-recompiling Marvel Ultimate Alliance Gold Edition (X360, Title ID 415607DA). The game boots and initializes GPU/audio fine under the recompiled runtime, but the guest kept failing to open `D:\z\assetsfb.wad` (NtCreateFile -> STATUS_OBJECT_PATH_NOT_FOUND / 0xc000000f), then crashed with a null guest pointer deref once it tried to use a `ui\menus\*.igb` asset that lives inside that wad.

Initial (wrong) theory: the game data dump was incomplete and the real `.wad` simply hadn't been extracted/ripped. Re-extracted from a fresh, pristine retail xiso (via extract-xiso) and got the exact same result: the disc itself only ships `z\assetsfb.zip`, never a `.wad`. So the dump wasn't corrupt — this really is what's on the disc.

Breakthrough: a sibling Raven/Alchemy title (X-Men Legends II - Rise of Apocalypse) had a real, non-empty `assetsfb.wad` sitting in an already-extracted dump elsewhere on disk. Read its first bytes:
`50-4B-03-04-...` = `PK\x03\x04`, the standard ZIP local-file-header magic. Compared against the MUA `assetsfb.zip`'s own header — identical magic.

Conclusion: `assetsfb.wad` IS a ZIP archive. The Alchemy engine's package/`.fb` descriptor system reads asset data straight out of a ZIP container regardless of what extension it's given. On a real Xbox 360, the disc apparently ships it pre-renamed to `.wad` (or the install step renames it); nothing about the container format itself changes.

Fix: `cp z\assetsfb.zip z\assetsfb.wad` (plain byte-identical copy/rename, not a rebuild or repack). This immediately cleared every `assetsfb.wad`-related NtCreateFile failure and the downstream null-pointer crash, and let the recompiled build run stably past the asset-loading stage (35s+ continuous run with zero fatals, versus a hard crash within seconds before).

Generalizable lesson: when a game-engine "custom container" won't open and you're about to reverse its binary format, check the file's magic bytes against common archive formats first (ZIP `PK\x03\x04`, RIFF, etc.) — Alchemy-engine `.wad`/`.pkg`/similar-looking extensions are sometimes literally just renamed ZIPs. If you have ANY known-good reference copy of the same container type (even from a different game on the same engine), diff its header before attempting a from-scratch format reversal — it can turn a multi-session RE task into a one-line `cp`.
