# Moving a Ghidra project between machines or users

## A Ghidra project directory (.rep plus .gpr) is portable, bu…

A Ghidra project directory (.rep plus .gpr) is portable, but three things block it and none of them announce themselves clearly.

## 1. NotOwnerException

    ERROR Abort due to Headless analyzer error:
    ghidra.util.NotOwnerException: Project is owned by <name>

The owner is recorded as plain text in `<project>.rep/project.prp`. Ghidra
refuses to open a project owned by a different username - which is every project
moved between a Windows account and a Linux one. Rewrite the value:

    sed -i 's/VALUE="OldUser"/VALUE="newuser"/' '<project>.rep/project.prp'

Keep a copy of the original first. Nothing else in the project references the
owner.

## 2. Stale lock files

`<project>.lock` and `.lock~` record the host and user that last held the
project. Copying them across means the new machine sees a lock held by a
machine that is not it. Do not copy them; they are recreated on open.

## 3. Version differences

A project written by Ghidra 12.1 opens in 12.1.3 with no prompt. Verify before
trusting it, with headless rather than the GUI:

    analyzeHeadless <projectDir> <ProjectName> -process <program> -noanalysis

## Checking what is actually in a project without opening the GUI

`.rep/idata/00/*.prp` names each program; the matching `~*.db` directory is its
size. For content, a two-line GhidraScript through headless beats clicking:

    analyzeHeadless <dir> <Project> -process <prog> -noanalysis \
        -scriptPath ~/ghidra_scripts -postScript ReportProgram.java

Counting functions whose names do not start with `FUN_` gives the number that
were actually named by a human or a tool - the real measure of how much analysis
a project carries.

## Getting an existing project's program to the MCP server

The GhidraMCP plugin serves the program open in ITS OWN CodeBrowser tool, and
only one CodeBrowser can bind the port. Opening a program by double-clicking it
while an empty CodeBrowser already exists creates a SECOND CodeBrowser: the
program is open and visible on screen, the server keeps answering "No program
loaded", and the two facts look contradictory.

Order that works: start Ghidra with no tool running, then open the program from
the project window. That gives one CodeBrowser holding both the program and the
port.

## Two GUI traps met on the way

**`xdotool windowkill` kills the whole application.** It destroys the X client,
not the window, so using it on a Ghidra window takes down the JVM and every
other window it owns. Use a graceful close (`wmctrl -c`, or the window's own
close button) when the process should survive.

**Do not click list rows by pixel.** Two attempts at the same visible row
selected a different row and then nothing, costing several screenshot rounds.
Type into the view's filter box until one item remains, then click that - the
position becomes unambiguous and the click stops being a guess.
