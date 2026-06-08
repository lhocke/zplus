# vendor/tailwind-plus

Owner drops Tailwind Plus components here. The build environment cannot reach
~/Downloads (OS TCC-protected), so Plus components are vendored manually.

## Expected components

Three components are used by the Phase 1 web shell. Each has a corresponding
plain-Tailwind placeholder in the source tree, marked with a
`// TAILWIND-PLUS SWAP SEAM` comment at the component boundary. Dropping in the
Plus version is a localized swap — the surrounding layout and theme wiring are
unchanged.

| Component | Plus version to drop in | Placeholder location |
|---|---|---|
| Slide-over / drawer | Slide-over (mobile sidebar) | `src/ui/Drawer.ts` |
| Segmented control | RadioGroup / SegmentedControl | `src/ui/ThemeSwitcher.ts` |
| Modal dialog | Dialog | `src/ui/Dialog.ts` |

## How to vendor

Copy the Plus component source files into this directory, then update the
import in the corresponding placeholder file to point here instead of the
inline plain-Tailwind implementation. No other changes should be needed.

## License

Tailwind Plus is licensed to the project owner. These files must not be
committed to a public fork or redistributed.
