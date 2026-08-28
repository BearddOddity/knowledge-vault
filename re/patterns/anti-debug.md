<!-- summary: IsDebuggerPresent, NtQueryInformationProcess -->
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
