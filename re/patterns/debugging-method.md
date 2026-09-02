<!-- summary: Validating a backtrace before you believe it (and before you retract on it) -->
# debugging-method

## Validating a backtrace before you believe it (and before you retract on it)

In a static recompilation the lifted functions are real host functions, so a host backtrace (`CaptureStackBackTrace` on Windows) at any probe point gives a genuine caller chain. The frames are trustworthy. What can lie is the **symbolisation** — turning an RVA into a function name via the linker map. Two failure modes, both worth checking explicitly before a backtrace is allowed to overturn anything:

**1. Identical COMDAT folding (ICF).** The linker merges functions with identical machine code, so several symbols share one address, and an RVA→name lookup returns whichever sorted first. This is not rare in lifted code, where thousands of small functions have identical bodies: in one real build, 255 addresses carried more than one `sub_` symbol and a single address carried 224 names. Test it by grouping map symbols by address and checking whether the specific functions on your path appear in a multi-name group. If they do, the name is a coin flip and the backtrace cannot name that frame at all.

**2. Offsets that escape their function.** A lookup returns the nearest preceding symbol, so if the real function is absent from the map (static, local, or not exported) every frame inside it is attributed to whatever symbol precedes it. Test by computing each symbol's extent from the next distinct address in the map and confirming the frame offset falls inside it, and separately that no unlisted symbol could sit between. A frame at `sub_X+0x48E` in a function whose host extent is `0x950` with the next symbol immediately after is sound; the same offset in a function whose extent is `0x100` is misattributed.

Note the comparison must be **host extent vs host offset**. Comparing a host RVA offset against the *guest* function's size is meaningless — lifted code expands substantially, and a 97-byte guest function routinely becomes 0x950 bytes of host code. Making that invalid comparison once produced a confident, wrong claim that frames were misattributed.

**The larger lesson: a retraction is a claim and needs the same standard as the thing it retracts.**

On the case that produced this note, a mechanism was established from a backtrace, then withdrawn because a probe showed the suspect function was entered "only 4 times, on 4 different objects, none of them the object of interest". That reasoning is a non-sequitur. A teardown routine walking object A releases A's *fields*, which are necessarily different objects from A. "Different `this`" was never evidence against the mechanism, and a correct finding was discarded because one number looked surprising and its relevance was never questioned.

Scepticism aimed at one's own conclusion feels like rigour, and it is not automatically rigour. Withdrawing a finding on weak grounds is the same error as asserting one on weak grounds, and it is more expensive, because it also destroys work already done.

**Two practical rules that resolve this class:**

- Run the competing probes in the **same build**, in one run. Two measurements from two builds can disagree for reasons that have nothing to do with the question — a different fix, a different allocation layout, a probe placed at a label the path skips. In the same run they must be reconciled, not chosen between.
- The bar for writing a position down: **does it explain every number already observed, or does it require discarding some of them?** The position that survived here accounted for the backtrace, both probe counts, the changing field value and the identity of the writer simultaneously. Each earlier position had to dismiss at least one observation as noise.
