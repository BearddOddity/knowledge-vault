# Qt6 GUI apps under WSLg

## A Qt6 app launched in a WSL lab can open as a Windows windo…

A Qt6 app launched in a WSL lab can open as a Windows window instead of an X window, because WSLg sets WAYLAND_DISPLAY for every process and Qt prefers Wayland whenever it is set.

SYMPTOM
The process starts, stays in state R burning CPU, and never maps a window - not
on the nested Xephyr display, not on WSLg's own X server. `xwininfo -root -tree`
shows nothing new on either. It reads as a hung application, and every plausible
cause is somewhere else: a splash screen that will not finish, a missing GL
driver, a broken video decoder.

Time was lost chasing exactly those. The app in question (Task Manager TMOG)
plays a 10-second splash video at startup and logged real-looking failures -
`Failed setup for format vulkan`, `MESA: error: ZINK: failed to choose pdev`,
`libEGL warning: egl: failed to create dri2 screen`. All were noise. Forcing
software GL cleared the EGL errors and changed nothing, because the window was
never going to appear on X at all.

DIAGNOSIS
    echo $WAYLAND_DISPLAY      # wayland-0 in any lab process
If it is set, Qt6 is on Wayland and the window is a Windows window, wherever you
were looking for it.

FIX
    env -u WAYLAND_DISPLAY QT_QPA_PLATFORM=xcb GDK_BACKEND=x11 <app>

`re-desktop` already does this for the XFCE session, so apps started from inside
the desktop are fine. Anything launched from the MCP, from `wsl.exe`, or from a
plain shell inherits WSLg's environment and needs it explicitly - which is why a
wrapper script in /usr/local/bin is worth the file.

TWO RELATED TRAPS FOUND ALONGSIDE
- **xfsettingsd caches keyboard shortcut commands.** Changing an xfconf binding
  while a session runs leaves the OLD command bound; the shortcut keeps
  launching the previous program and the change looks like it failed. It takes
  effect on a fresh session. Restarting xfsettingsd by hand from outside the
  session's dbus context is worse - its key grabs come back broken and the
  shortcut then launches nothing.
- **xfsettingsd spawns with its own PATH,** which does not reliably include
  /usr/local/bin. Bind shortcuts to an ABSOLUTE path; a bare command name fails
  silently with no error anywhere.

ALSO WORTH KNOWING
- A .deb can under-declare its dependencies. This one listed libc6, libgcc,
  libstdc++ and libsystemd, and linked against Qt6 Multimedia. `ldd <binary> |
  grep 'not found'` answers it in one step rather than one failed launch at a
  time.
- Desktop-entry overrides belong in /usr/local/share/applications, which
  outranks /usr/share in XDG_DATA_DIRS and survives package upgrades. Use
  `NoDisplay=true` to hide a launcher whose package cannot be removed because
  something depends on it.
