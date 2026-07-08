<!-- .github/release-notes-template.md -->
Z+ is unsigned. Your OS will warn you on first launch — this is expected for
an independently-built app without a paid developer certificate. Here's how
to run it anyway:

**macOS:** Double-click Z+ once — Gatekeeper will block it. Then open
**System Settings → Privacy & Security**, scroll to the security section,
and click **Open Anyway** next to the Z+ entry (you'll confirm with your
password). This is the current macOS path for apps built outside the Apple
Developer Program; the old right-click-Open shortcut no longer offers the
override on macOS 15 and later.

**Windows:** SmartScreen will say "Windows protected your PC." Click **More
info**, then **Run anyway**.

**Linux (AppImage):** `chmod +x Z+*.AppImage` then run it directly. No
install step — it's a single portable executable.

**Linux (.deb):** `sudo apt install ./z-plus_*.deb` (or your distro's package
manager equivalent).

Saves live in a shared app-data location on your machine and export/import to
a file you choose from the Saves panel — the same 3 manual slots + 1
death-autosave slot as the web demo.
