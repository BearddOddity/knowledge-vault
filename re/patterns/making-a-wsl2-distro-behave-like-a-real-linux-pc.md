<!-- summary: systemd via wsl.conf and a clipboard bridge between the nested X server and WSL… -->
# Making a WSL2 distro behave like a real Linux PC

## systemd via wsl.conf and a clipboard bridge between the nested X server and WSLg are the two changes that separate a WSL desktop from a working machine.

A WSL2 distro running a desktop looks complete and is not. Two specific gaps, both fixable, plus a warning about which problems are NOT worth fixing.

## systemd

WSL's default PID 1 is its own minimal init with no service manager, so there is
no cron, no timers, no NetworkManager, no printing, no container daemon and no
user units. `systemctl is-system-running` reports `offline`.

    [boot]
    systemd=true

**Requires a full `wsl --shutdown`.** It changes PID 1, so terminating and
restarting the distro is not enough - `systemctl` keeps reporting `offline` and
every unit command fails in a way that looks like the change did not apply.

After enabling, check what regressed rather than assuming: whether the isolation
config still holds (`/mnt` should show only the intended shares), the network,
and any bind mount a desktop depends on. In this lab `/tmp/.X11-unix` stayed
mounted read-only exactly as before, so the nested X server's remount logic was
unaffected.

`tpm-udev.path` / `tpm-udev.service` fail on every boot because WSL passes no
TPM through. One permanently failing unit makes systemctl report the whole
system `degraded`, which trains you to ignore that word and hides real failures.
Mask them and `systemctl reset-failed`; the state becomes `running`.

## Clipboard across a nested X server

Running a desktop inside Xephyr gives a second X display (`:10`) that is
completely separate from WSLg's `:0`. Only `:0` is bridged to the Windows
clipboard, so text copied inside the desktop cannot be pasted into Windows at
all, and neither can the reverse.

Diagnose it in one step: set a known string on `:10`, then read `:0`. If they
differ - and `:0` shows whatever is actually on the Windows clipboard - the two
are unrelated.

There is no X event for "the selection owner changed on another display", so a
poller is the mechanism available. Compare both displays a couple of times a
second and copy whichever changed to the other. Two things it must get right:

- Record the new value on BOTH sides after a copy. Otherwise the destination
  looks changed on the next pass and gets copied straight back, and the two
  clipboards ping-pong indefinitely.
- Seed from the current state at startup, so whatever is already on the
  clipboard is not treated as a fresh copy.

## xclip hangs a captured pipe

`xclip -i` forks a child to serve the selection, and that child inherits stdout.
If stdout is a pipe the caller waits for an EOF that never arrives. Any wrapper
that captures output - a subprocess call, an MCP tool - blocks until its
timeout, which reads as "the lab froze". Redirect the child's stdout to
/dev/null and give it its own session.

## What is NOT worth fixing

Notes accumulated while automating a lab tend to describe the automation
boundary, not the machine: one-shot processes being killed when the calling
`wsl.exe` returns, `pkill -f` matching its own caller, CRLF shebangs on an NTFS
share, choosing the right display. Every one of those is invisible to somebody
using the desktop as a desktop. Before working through such a list in the name
of "making it fully functional", check who actually encounters each item - the
answer is often nobody, and the real gaps are elsewhere entirely.
