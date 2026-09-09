<!-- summary: D3D8-on-D3D11 shim for a Xbox static recompilation drew geometry as solid black despite correct vertex colors; root cause was two separate defects only visible once the test harness judged actual pixels instead of HRESULTs. Follow-up 3D test then found depth-testing and backface culling both non-functional. -->
# d3d8-shim-black-geometry-and-depth-culling-defects

**Technique:** Pixel-readback test harness (d3d8_debug_count_nonclear / d3d8_debug_pixel_at) instead of HRESULT-only pass/fail

## Notes

## Background

X-Men Legends static recompilation (Xbox -> PC) includes a D3D8-over-D3D11 shim. The graphics harness had been reporting every draw stage as PASS because it only checked `SUCCEEDED(hr)` on Direct3D calls - never inspected the actual framebuffer.

## Defect 1: black triangle despite correct colors

A test triangle with distinct per-vertex colors rendered as solid black. HRESULTs all succeeded. Root cause turned out to be TWO independent bugs stacked:

1. **Depth-clear ordering bug in the harness/shim clear path** - the depth buffer was being cleared to the wrong value/at the wrong point relative to the color clear, so depth test rejected color writes it shouldn't have (or the clear itself was zeroing color output). 
2. **Vertex color pipeline defect** - even once depth stopped eating the pixels, colors weren't reaching the pixel shader/output correctly; traced separately from the depth issue.

Both had to be fixed before the triangle rendered with its intended per-vertex colors. Neither was visible from HRESULT checking alone - `IDirect3DDevice8::Clear`, `DrawPrimitive`, `Present` all returned S_OK throughout.

## The instrument that made this findable

Built `d3d8_debug_count_nonclear(bgra_clear_color)` - maps the D3D11 back buffer, walks every pixel, counts how many differ from the known clear color, and returns the dominant non-clear color found. And `d3d8_debug_pixel_at(x, y)` for point sampling.

This turned "does it look right" (which requires a human looking at a screenshot) into a scriptable pass/fail: harness now asserts pixel counts and dominant colors, not just HRESULTs. This is the general fix for graphics-shim development: **HRESULT success is necessary but nowhere near sufficient; any draw-path test harness needs a framebuffer readback assertion or it will pass while producing garbage output.**

## Defect 2 (found immediately after, via the same harness extended to 3D): depth test and backface culling both non-functional

Once flat/untransformed 2D drawing worked, a proper 3D test (perspective-transformed geometry, multiple triangles at different depths, some facing away from camera) showed:
- **Depth testing does nothing** - back geometry draws over front geometry regardless of Z.
- **Backface culling does nothing** - triangles facing away from the camera still rasterize and shade.

Both are the next work item - not yet root-caused as of this write-up, only confirmed present via the pixel-readback harness (a correctly z-tested/culled scene has a predictable, checkable pixel signature at known sample points; this scene didn't match it).

## Why this belongs in the vault

General lesson for anyone building a graphics API shim (D3D8->D3D11, D3D9->Vulkan, whatever): **write the pixel-readback assertion harness before you trust any "it compiles and returns S_OK" milestone.** Two real, separate rendering-pipeline bugs hid behind all-green HRESULT checks in this project; only checking actual framebuffer content surfaced them, and immediately surfaced two more (depth/cull) once 2D-flat draws stopped being the only test case.
