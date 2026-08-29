# Finding vtables without RTTI

## RTTI-based vtable discovery only finds classes the compiler…

RTTI-based vtable discovery only finds classes the compiler emitted type information for. A class built without it is invisible to that method entirely, and on one real binary such a class was the single blocker for a port.

## The other end of the problem

A constructor assigns the vptr with `mov [reg], <address>` where the address
begins an array of code pointers. That store is evidence, and it needs no type
information at all.

Guards that keep it from naming ordinary data:

- the target must begin at least ~4 consecutive pointers to code
- the store must be to `[reg]` or a small positive displacement, which is where a
  vptr lives; a large offset is some other member being initialised
- skip vtables the RTTI pass already covered

Measured on a 17,000-function game binary: 1,261 candidate vtables, of which
1,203 were already known from RTTI and **58 were not**. The overlap is what makes
the result trustworthy - the method independently rediscovers almost every vtable
the RTTI pass found, so the additions are credible rather than noise.

Run it AFTER the RTTI pass, never instead of it. RTTI yields real class names;
this yields only `vt_<address>`.

## Section flags can be actively misleading

On the XBE tested, **`.rdata` is marked executable**. Any filter shaped as "the
target must live in a non-executable block" therefore rejects every vtable and
constant table in the binary. This produced two wrong conclusions before a
diagnostic printed `block=.rdata exec=true`.

Use `getInstructionAt(target) == null` to separate a table from code. It is
independent of how the section is flagged and works on containers that mark
everything executable.

## Debugging a filter that returns zero

When a scan finds nothing against a case already proven to exist, the instinct is
to adjust string handling and re-run. That wasted two cycles here.

Print what every predicate actually sees at one known-good instruction instead.
One diagnostic found both real bugs immediately:

- the destination operand renders as `dword ptr [ESI]`, so `startsWith("[")`
  never matches while `contains("[")` does
- the section-flag guard above

A second run of the same sweep will also report different "already known" counts
than the first, because slots named during the first pass now match the
already-known test. That is expected, not instability - say so when reporting it,
or the numbers look unstable.
