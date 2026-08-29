<!-- summary: Census a mapped guest null page instead of unmapping it -->
# static-recompilation-debugging

## Census a mapped guest null page instead of unmapping it

A static recompiler that maps guest memory with a flat offset — `host = guest + offset`, with the mapping starting at guest 0 — has guest virtual address 0 mapped **by construction**. A null pointer dereference in lifted code therefore does not fault. It quietly returns 0, or returns whatever an earlier null-derived write left there.

This hides an entire class of bug indefinitely. In one Xbox recompilation project, three separate walls had the same invisible cause: a function walked a NULL object for a whole loop, writing to guest VA 0xC and reading it back next iteration as if it were a live object; an allocator lookup returned NULL and the code did `MEM32(0)` to fetch an indirect-call target, getting 0 rather than a fault; and two guards zeroed a bad pointer and then dereferenced it.

The obvious response — unmap page 0 so it faults — is usually wrong, for two reasons.

First, it may regress a real fix. Low memory is often deliberately left as readable zeros because something in the boot path reads it; in this project that had resolved a 7.6-million-iteration spin. Unmapping reintroduces the spin and buries the thing you were trying to see.

Second, unmapping gives you exactly one data point: the first hit kills the run. What you actually want is the whole list.

Do this instead. Make the page `PAGE_NOACCESS`, install a vectored exception handler, and on each fault **record and resume** rather than die:

- record the guest offset, whether it was a read or a write, and the faulting host RIP (plus its RVA, so it resolves against a linker map)
- flip the page to `PAGE_READWRITE`, set the single-step flag, return `EXCEPTION_CONTINUE_EXECUTION`
- on the single-step trap, restore `PAGE_NOACCESS` and continue

One boot then yields the complete census instead of the first hit. Print it incrementally as well as at shutdown, because the run may well crash before shutdown.

Read the read/write split first, before theorising. It reframes the problem immediately. A census showing 22,382 reads against 21 writes says the page is not being corrupted by a stray write — it is being *read* by pointers that are already wrong, and the bug is upstream of the page entirely. That single ratio killed a plausible standing hypothesis (a thread-local segment base left at 0, so `fs:[0x20]` stores would land at guest 0x20) in one line: guest 0x20 turned out to be read and never written.

Rank the sites by access count. The distribution is usually extremely skewed — here two adjacent instructions in one function were 91% of all traffic — so one function is worth more attention than the other seventy-odd combined.

Build it behind a compile-time flag in a **separate build directory**, the way a sanitiser build is kept separate. It changes timing, so coverage and progress numbers measured on it are meaningless. Say so in the build script, the header and the startup banner, because someone will otherwise quote its numbers back at you.
