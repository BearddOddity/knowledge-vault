<!-- summary: IsDebuggerPresent, NtQueryInformationProcess, NtSetInformationThread (ThreadHid… -->
# anti-debug

## IsDebuggerPresent

Win32 API that reads the BeingDebugged byte at PEB+0x02 and returns it.

**Spotting it:** a call to `kernel32!IsDebuggerPresent` whose result feeds a conditional jump. If the import was avoided, look for a direct read of `gs:[0x60]+0x02` (x64) or `fs:[0x30]+0x02` (x86) instead.

**Defeating it:** in x64dbg, break on the call and zero EAX before the test, or patch the BeingDebugged byte to 0 once at attach so every later check passes. ScyllaHide handles both automatically.

## NtQueryInformationProcess

Queries the kernel about the process instead of reading the PEB, so patching BeingDebugged alone does not defeat it.

**The information classes that matter:**
- `ProcessDebugPort` (0x07) — returns a non-zero port value when a debugger is attached.
- `ProcessDebugObjectHandle` (0x1E) — returns a valid handle when debugged.
- `ProcessDebugFlags` (0x1F) — returns 0 when debugged, 1 when not. Note the inverted sense; this one catches people who blanket-zero the output buffer.

**Spotting it:** a call to `ntdll!NtQueryInformationProcess` where the second argument is 7, 0x1E, or 0x1F. Ghidra often shows the class as a bare integer, so grep the decompilation for those constants rather than for a named enum.

**Defeating it:** hook the function and fix up the output buffer per class — zero it for 0x07 and 0x1E, but write 1 for 0x1F. ScyllaHide handles all three; a hand-rolled hook that zeroes everything will fail the ProcessDebugFlags check and is a common way to get caught.

## NtSetInformationThread (ThreadHideFromDebugger) and why import scans miss it

Detaches the debugger from the thread rather than detecting one. Seen in `prime.exe` (crackmes.one).

```c
h = GetModuleHandleA("ntdll.dll");
f = GetProcAddress(h, "NtSetInformationThread");
if (f(GetCurrentThread(), 0x11, 0, 0) != 0) exit;   // 0x11 = ThreadHideFromDebugger
```

A non-zero return means the call failed, which the binary treats as "being debugged" and bails. Under normal execution it returns 0 and the program continues.

**The part that matters beyond this one API:** it is reached through `GetModuleHandleA` + `GetProcAddress`, so **it never appears in the import table**. Any triage that only walks `DIRECTORY_ENTRY_IMPORT` will report the binary as import-clean and miss the protection entirely. The only trace is the literal strings `ntdll.dll` and `NtSetInformationThread` sitting in `.rdata`.

**Detection:** cross-reference the API name strings, not just the imports. `re-triage` now scans strings against the API watch list for exactly this reason - it was added after missing this on a live target.

Names worth flagging in strings even when absent from imports:

```
NtSetInformationThread / ZwSetInformationThread   ThreadHideFromDebugger
NtQueryInformationProcess                          debug port / object / flags
NtQueryObject                                      debug object handle
DbgBreakPoint / DbgUiDebugActiveProcess            anti-debug
BlockInput                                         anti-analysis
```

**Defeating it:** irrelevant to static analysis - the binary was never run under a debugger, so the check never fired and the password was recovered without touching it. If a debugger is needed, hook the call and return 0, or patch the branch. ScyllaHide handles it.

**General rule:** anti-debug costs nothing when the target is read rather than run. Reach for dynamic analysis only when the algorithm genuinely cannot be read statically.
