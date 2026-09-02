<!-- summary: Deciding which console limits a port may raise -->
# static-recompilation

## Deciding which console limits a port may raise

When porting a console binary to PC by static recompilation, the temptation is to treat every hardware limit as removable ("it's a PC now"). It is not. The test is who enforces the limit.

**Host-enforced limits can become settings.** If the number only exists in the runtime you are writing, you own it. In the X-Men Legends port, the Xbox's 64 MB of RAM was a compile-time constant in the host kernel layer; it became a variable set at startup from an environment variable, and the kernel's free-memory query derives from it.

**Guest-enforced limits cannot move.** If the translated binary performs arithmetic that assumes the limit, raising it corrupts memory silently. The same port has a hard 256 MB ceiling because the game masks resource pointers with `& 0x0FFFFFFF` — 28 bits. There are thousands of those masks in translated code. That ceiling gets documented, never exposed as a setting.

**The subtle middle case: a raisable limit with a non-obvious granularity.** The Xbox's memory bus is 26-bit, so RAM wraps modulo 64 MB, and a faithful port reproduces the wrap with mirrored views. That means the RAM setting cannot accept an arbitrary size — an odd value puts the mirror where the guest's own allocator arithmetic does not expect it. The setting accepts exactly the two layouts the hardware defined (retail 64 MB, devkit 128 MB). Offering a free-form slider here would look more generous and would corrupt memory.

**The escape hatch: keep new content outside the guest address space entirely.** Anything the original binary never sees is unconstrained. High-resolution texture replacement in this port lives wholly in host memory: the game keeps its small texture object and its own pixels, and the renderer binds a different shader resource view at draw time. None of the guest limits apply — not the RAM size, not the arena, not the 28-bit pointers — because no guest pointer ever refers to the replacement. This is where "modern PC budget" is literally true, and it is worth structuring features this way deliberately.

**Corollary for asset replacement identity:** hash the content at the point it reaches the GPU rather than hooking the asset loader. Hooking ties replacement to one asset pipeline and breaks when the same texture arrives another way; a content hash of the level-0 pixels is pipeline-independent, and the "miss" log line naming the expected filename becomes the entire authoring interface.

**Practical note on generated mip chains (D3D11):** a replacement many times larger than the original is minified enormously and will alias worse than the texture it replaced unless it has mips. A mip chain cannot be generated on an IMMUTABLE texture created with initial data, so the creation path must be `MipLevels = 0`, `USAGE_DEFAULT`, `BIND_RENDER_TARGET`, `MISC_GENERATE_MIPS`, then upload level 0 and call `GenerateMips`. Also define `COBJMACROS` before including `d3d11.h` in C, or the `ID3D11Device_*` names compile as implicit function calls and fail at link with unresolved externals.

Size ceilings for replacements should be stated as policy with the reasoning attached, not as if they were hardware. Each doubling of a texture's side is 4x the memory: from a 64x64 original, 512 costs 1.3 MB, 1K 5.3 MB, 2K 21.3 MB, 4K 85.3 MB with mips. A 4096 cap is a VRAM budget decision even though the feature level permits 16384, and saying so in the header lets the next reader weigh it instead of guessing.
