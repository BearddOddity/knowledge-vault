<!-- summary: Traced a container/pointer corruption wall in the X-Men Legends recompilation down through 5+ hops of indirect dispatch to a 4-byte guest-stack leak in two specific functions, confirmed by two independent instruments naming the same pair. -->
# xbox-recomp-stack-leak-traced-to-two-functions

**Technique:** Chained indirect-call tracing (tag_callers/watch_icall_step_up) + esp-depth-vs-epilogue cross-check (depth_audit.py)

## Notes

## The wall

Coverage was stuck: a container object's data pointer kept ending up corrupted (address 0x0111AA60 recurring in ABI violation dumps), reached only through several layers of indirect (vtable) dispatch with no real call stack to walk. Earlier hypotheses about "which container is wrong" were all wrong - traced step by step:

1. Confirmed the corruption was NOT in the object construction path itself.
2. Used `watch_icall_step_up.py` to walk the indirect dispatch chain backward one hop at a time (no real return addresses exist to unwind, so this required recording resolved call targets + synthetic site ids at each indirect call and re-running with the newly identified caller as the new watch target).
3. Landed on a specific function pair after 5+ hops.
4. Cross-confirmed independently via `depth_audit.py`'s esp-depth census (see static-recompilation-debugging pattern, "esp-depth census" entry): out of 1,832 executed direct call sites, only 4 returned at a depth their own callee's epilogue could not explain. Two of those four were the SAME two functions the indirect-dispatch trace had already implicated.

## Result

Two functions confirmed (by two unrelated instruments agreeing) to leak 4 bytes of guest stack per call under some code path. This is a small, surgical target for the actual fix - not yet applied as of this write-up, but fully localized.

## Why the corroboration mattered

Chasing a stack-corruption bug through 5+ layers of indirect dispatch produces a LOT of plausible-looking false leads (any function anywhere in the chain "looks" suspicious once you're deep in it). Having a second, structurally unrelated instrument (static epilogue analysis vs dynamic call-chain tracing) converge on the exact same two functions is what turned "a plausible suspect" into "confirmed." Don't stop at one instrument's answer for a corruption bug reached through many hops - get independent confirmation before spending fix effort.

See also: static-recompilation-debugging pattern (esp-depth census technique) and recomp-stack-tracing-instruments tool note for the instruments themselves.
