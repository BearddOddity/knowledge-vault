<!-- summary: IsDebuggerPresent -->
# anti-debug

## IsDebuggerPresent

Win32 API that reads the BeingDebugged byte at PEB+0x02 and returns it.

**Spotting it:** a call to `kernel32!IsDebuggerPresent` whose result feeds a conditional jump. If the import was avoided, look for a direct read of `gs:[0x60]+0x02` (x64) or `fs:[0x30]+0x02` (x86) instead.

**Defeating it:** in x64dbg, break on the call and zero EAX before the test, or patch the BeingDebugged byte to 0 once at attach so every later check passes. ScyllaHide handles both automatically.
