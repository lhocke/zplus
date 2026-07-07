<!-- .github/release-notes-template.md -->
Z+ is unsigned. Your OS will warn you on first launch — this is expected for
an independently-built app without a paid developer certificate. Here's how
to run it anyway:

**macOS:** Right-click (or Control-click) the Z+ app and choose **Open**,
then confirm **Open** in the dialog that appears. (Opening it by double-click
the first time will be blocked by Gatekeeper — the right-click path is the
one that offers the override.) Z+ is ad-hoc signed — this bypass is
Apple's documented path for unsigned/ad-hoc-signed apps built outside the
Apple Developer Program.

**Windows:** SmartScreen will say "Windows protected your PC." Click **More
info**, then **Run anyway**.

**Linux (AppImage):** `chmod +x Z+*.AppImage` then run it directly. No
install step — it's a single portable executable.

**Linux (.deb):** `sudo apt install ./z-plus_*.deb` (or your distro's package
manager equivalent).

Saves live in a shared app-data location on your machine and export/import to
a file you choose from the Saves panel — the same 3 manual slots + 1
death-autosave slot as the web demo.
