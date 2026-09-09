# re-lab-mcp

## The lab's CLI tools are exposed as an MCP server (`re-lab`)…

The lab's CLI tools are exposed as an MCP server (`re-lab`), registered at user scope and running inside Kali:

    /opt/re-lab-mcp/lab_mcp.py   (source in /mnt/share/lab_mcp.py)

Tools: lab_exec, lab_exec_root, lab_triage, lab_vbinfo, lab_run_target, lab_kill, lab_windows, lab_window_tree, lab_screenshot, lab_click, lab_type, lab_key, lab_focus, lab_mem_strings, lab_dump_memory, lab_fix_dump, lab_disas, lab_hexdump.

It exists for one reason beyond convenience: commands sent through PowerShell -> wsl.exe -> bash get mangled. Unix paths are rewritten (`/opt/...` became `C:/Program Files/Git/opt/...` in a registered MCP command), and shell variables are silently emptied, producing errors like `BadWindow ... 0x0` and `grep: /proc//maps`. Several "it's broken" diagnoses during the BFCrackMe work were mangled commands rather than real faults. Running the server inside the lab removes that boundary entirely - `lab_exec` is the tool to reach for by default.

`lab_exec_root` covers reading another process's memory and attaching a debugger. Root has CAP_SYS_PTRACE, so this works with kernel.yama.ptrace_scope left at its default - do not weaken that setting.

## `lab_r2`'s `iE` (export listing) on a large game DLL can re…

`lab_r2`'s `iE` (export listing) on a large game DLL can return tens of thousands of characters and blow the tool's per-call token cap outright. Dump it to a file once inside the lab (`lab_exec: r2 -q -c 'iE' /mnt/share/thefile.dll > /tmp/exports.txt`) and `grep` that file for subsequent lookups instead of re-running `iE` with a `~grep` filter each time - the filtered `iE~pattern` form can still blow the cap on a broad pattern, and re-running full analysis (`aaa`) on every call is also wasted work once the symbols you need are already resolved once.

For X-Men Legends II specifically: the game's own copies of `libIGCore.dll`/`libIGGfx.dll` were already staged at `/mnt/share/libIGCore_xml2.dll` / `libIGGfx_xml2.dll` from earlier work (distinct from the 2010 Alchemy SDK's copies also present under `/mnt/share/AlchemyExtracted/`) - always disassemble the `_xml2` ones for anything about how the shipped game itself behaves; the SDK build disagrees with it in more than one place. `class_registrations.tsv`, `class_hierarchy.tsv`, `class_parents.tsv`, and `igsg25_exports.txt` at the top of `/mnt/share` are pre-extracted class/field-name tables from earlier sessions - grep those before re-deriving the same information from scratch.
