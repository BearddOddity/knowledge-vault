# recomp-stack-tracing-instruments

## Set of small diagnostic instruments built for the X-Men Leg…

Set of small diagnostic instruments built for the X-Men Legends static recompilation to trace stack/register corruption through recompiled indirect-call chains, where a normal debugger stack walk is useless because everything is one flat native call stack under a guest-stack emulation.

**tag_callers.py** - the recompiler pushes a literal 0 where a real return address would go, so a callee has no way to identify its own caller by inspecting the stack. This tags every DIRECT call site of a named target function with a unique small integer written to a global right before the call, so the callee (or an instrumented copy of it) can print "which site called me" on the fatal invocation. Answers "who calls X" when X has many call sites and only one of them matters.

**watch_icall_site.py / watch_icall_step_up.py** - same problem but for INDIRECT calls (vtable dispatch): records the resolved target address + a synthetic call-site id at every indirect dispatch, then lets you "step up" one level - rerun with the newly-identified caller now itself being watched, walking the real call chain backward one indirect hop at a time without ever having a real return-address stack to unwind.

**bracket_reg.py** - wraps a suspect register (ebx/esi/edi/etc, whichever the ABI checker flagged as "not restored") with a save-before/compare-after probe around one specific call, printing when and by how much it changes. Used to catch a stack imbalance exactly at the call boundary rather than guessing from the aggregate ABI violation report.

**depth_audit.py** - see the static-recompilation-debugging pattern entry "esp-depth census." Cross-references an ABI-build stderr log against each callee's own generated epilogue to find call sites returning at an esp depth their own callee cannot explain.

**symbolize_map.py** - the linker map's symbol column is section-relative, not RVA-relative for functions past the first section; naive RVA lookup silently attributes a crash to the WRONG function when the real faulting function is in a later section. This tool corrects for section base offsets before resolving RVA->symbol. Found via a bug where a crash was confidently attributed to the wrong function for an entire debugging session before someone checked the map file's actual column semantics.

All of these exist because standard debugging assumes a real call stack with real return addresses; a static recompiler that flattens guest code into a single host call stack under fake return addresses breaks that assumption, so every "who called this" and "did this function balance the stack" question needs a purpose-built instrument instead of a debugger backtrace.

## The hot-patch probe instrument's own `limit=N` argument is…

The hot-patch probe instrument's own `limit=N` argument is decorative only in this SDK's current implementation - it gets written into the generated comment next to the inserted probe line, but the actual print cap enforced at runtime is a single shared static counter per call-site macro (raised earlier in the same project to 5000), not the per-insertion N the tool call requested. Observed directly: a probe inserted with limit=200 printed over 4000 times in one run. Don't trust the requested limit when estimating how much log output a probe will produce, or when reasoning about whether a probe "must have" stopped firing due to hitting its own cap - check the actual print count in the log instead of assuming the requested limit held.

When a suspected bad value could be reached through any of many different indirect-call sites scattered across a large function (too many to hand-instrument one by one), it is faster to add one conditional check directly inside the runtime's own indirect-call dispatcher (the C function every `call [reg+N]`-style guest instruction routes through) that fires only when the resolved target equals the specific address of interest, logging whatever register/argument is suspect at that exact moment. This is a plain runtime source edit (not a generated-file hot-patch), so it needs a full rebuild of the recompiled title binary but not the recompiler tool itself, and it is trivial to remove again afterward. Confirmed this approach directly: it correctly reported zero hits for a target that turned out to be reached via an ordinary direct call all along, saving a long manual instrumentation pass across 23 separate indirect-call sites in one function.
