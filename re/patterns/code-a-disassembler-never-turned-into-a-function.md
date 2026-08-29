<!-- summary: A table nothing appears to write usually has a writer that was never promoted t… -->
# Code a disassembler never turned into a function

## A table nothing appears to write usually has a writer that was never promoted to a function - chase what REFERENCES an uncalled function and whether that referrer is itself lifted, because a DATA reference means indirect dispatch.

Applies to static recompilation, decompiler-based porting, and any analysis that
enumerates functions rather than instructions.

## The symptom that misleads

A global that the program clearly depends on appears to have no writer. Searching
the disassembly for the address finds only readers. The natural conclusion -
"this is written by code we do not have" - is usually wrong.

Two likelier explanations:

1. The writer exists but sits in **code the analyser never promoted to a
   function**. Anything working from a function list cannot see it.
2. The write goes through a **base pointer held in a register**, so the literal
   address never appears at the writing instruction.

## Measure the orphan code first

Count instructions that belong to no function. On one 17,000-function game
binary: **143,501 instructions across 6,973 contiguous runs**. That is not an
edge case, it is a large blind spot.

Promote conservatively. Requiring a run to be BOTH referenced from somewhere AND
to open with a recognisable prologue (`push ebp`, `sub esp`, `push ebx/esi`,
`mov edi,edi`) separates real entry points from misaligned data that happens to
disassemble. On that binary the filter kept 609 runs of 6,973, and creating
functions there moved 44,926 instructions into analysable code while leaving 11
candidates behind.

Measure before applying. Creating hundreds of functions changes the database
materially, and for a recompilation it changes generated output.

## Then chase the reference, not the address

For a function that nothing calls, the useful question is what REFERS to it and
whether that referrer is itself lifted. One line of output can be the entire
diagnosis:

    target=00216210  references=1
    from=003f4478  type=DATA  in=ORPHAN (not lifted)  insn=(data)

A **DATA** reference means the address is stored in a table of function pointers
and reached indirectly - a vtable slot, a static-initialiser array, a
registration table walked at startup. A tool that follows direct calls from an
entry point will never arrive there, no matter how complete its call-graph
traversal is.

So "nothing writes this table" became "the writer is only reachable through a
data pointer". That is a different problem and a far more tractable one: the
durable fix is to treat data-referenced function pointers as roots for
discovery, not just call targets.

## Why this matters more for recompilation than for reading

A human reading a listing can follow anything. A recompiler emits code for a set
of functions, so a function that was never discovered is not merely unannotated -
it is absent from the output, and the behaviour it provided silently never
happens. The failure appears far away, as a null pointer or an unknown indirect
call, with nothing pointing back to the missing code.

## Corroborating symptom

If the port already reports crashes in indirect-call dispatch, or a large count
of indirect calls executed, that is the same root cause seen from the other side.
Both say the binary dispatches through tables the discovery pass did not follow.
