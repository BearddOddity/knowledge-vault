<!-- summary: Check for .stab/.stabstr sections before assuming locals are anonymous - GCC/Mi… -->
# STABS debug symbols in MinGW binaries

## Check for .stab/.stabstr sections before assuming locals are anonymous - GCC/MinGW built with -g leaves a full symbol table naming every variable, its type and its stack offset.

Look for `.stab` and `.stabstr` in the section list during triage. Their presence means the binary was built with `-g` and never stripped, which is common in hobby crackmes and in debug builds shipped by accident.

FORMAT
`.stab` is an array of 12-byte entries:

    struct { uint32 n_strx; uint8 n_type; uint8 n_other; uint16 n_desc; uint32 n_value; }

The table is a sequence of per-object-file chunks. Each chunk opens with an
N_UNDF entry (n_type == 0) whose n_desc is the number of entries that follow
and whose n_value is the byte length of that chunk's slice of `.stabstr`.
String offsets are relative to the current chunk's slice base, so a parser that
treats n_strx as an absolute offset into `.stabstr` silently reads the wrong
names for every file after the first.

TYPES THAT MATTER
    0x64 N_SO    source file name, n_value = its start address
    0x24 N_FUN   function, "name:F(type)", n_value = address
    0x80 N_LSYM  local variable, "name:(type)", n_value = SIGNED offset from EBP
    0xa0 N_PSYM  parameter, same encoding
    0x44 N_SLINE line number, n_value = offset from function start

n_value for N_LSYM is a signed 32-bit offset, so read it as signed: -8 arrives
as 0xfffffff8.

READING THE DESCRIPTORS
`name:(0,3)` declares a variable of type (0,3). The `(file,index)` pairs are
resolved by the `name:t(0,3)=...` typedef entries earlier in the same table -
those give the primitive types, e.g. `int:t(0,3)` and `char:t(0,19)=r(0,19);0;127;`.
An array is `ar(26,6);0;7;(0,19)`, meaning a range-indexed array 0..7 of
char - i.e. char[8], with the bounds stated explicitly.

WHY IT IS WORTH THE FIVE MINUTES
It converts "which stack slot is the counter" into a table lookup, and it
states array bounds, which is what reveals an out-of-bounds access in the
target's own code.

TRAP
A STABS descriptor read as a plain string looks like application data. A
strings pass over a debug build surfaces lines such as `serial:(0,3)` and
`i:(0,3)`, which read convincingly as a substring range or a format string.
Check the section list before drawing conclusions from a string that looks
like a hint.
