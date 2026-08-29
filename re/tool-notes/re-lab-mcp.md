# re-lab-mcp

## The lab's CLI tools are exposed as an MCP server (`re-lab`)…

The lab's CLI tools are exposed as an MCP server (`re-lab`), registered at user scope and running inside Kali:

    /opt/re-lab-mcp/lab_mcp.py   (source in /mnt/share/lab_mcp.py)

Tools: lab_exec, lab_exec_root, lab_triage, lab_vbinfo, lab_run_target, lab_kill, lab_windows, lab_window_tree, lab_screenshot, lab_click, lab_type, lab_key, lab_focus, lab_mem_strings, lab_dump_memory, lab_fix_dump, lab_disas, lab_hexdump.

It exists for one reason beyond convenience: commands sent through PowerShell -> wsl.exe -> bash get mangled. Unix paths are rewritten (`/opt/...` became `C:/Program Files/Git/opt/...` in a registered MCP command), and shell variables are silently emptied, producing errors like `BadWindow ... 0x0` and `grep: /proc//maps`. Several "it's broken" diagnoses during the BFCrackMe work were mangled commands rather than real faults. Running the server inside the lab removes that boundary entirely - `lab_exec` is the tool to reach for by default.

`lab_exec_root` covers reading another process's memory and attaching a debugger. Root has CAP_SYS_PTRACE, so this works with kernel.yama.ptrace_scope left at its default - do not weaken that setting.
