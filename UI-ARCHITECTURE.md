# Frontend · S75 Studio 0.7

The web frontend now renders with React 19 and official Darwin UI components, using Darwin's source-copy distribution model. The existing Vue templates and template compilation step were removed. `@vue/reactivity` remains only as a small state engine for the existing hardware controllers; it does not render any UI.

## Where to refine the interface

- `src/studio.tsx`: application shell, sidebar, navigation, status and profile actions.
- `src/pages/`: eight separate screens: overview, keys, lighting, live, macros, screen, device and profiles.
- `src/ui/shared.tsx`: application composition around Darwin controls (fields, colors, file selection, feedback, battery).
- `src/ui/keyboard-preview.tsx`: actual 80-key layout from `keyboard.json`.
- `src/ui/lcd-preview.tsx`: LCD frame and media preview.
- `src/quick.tsx`: compact GIF / keyboard color tabs. File selection and drop send automatically here.
- `src/style.css`, `src/quick.css`: application layout, palette, sizing and responsive rules.
- `src/vendor/darwin-ui/`: official components, theme, MIT license and provenance. Prefer adjusting the application layer when applying a design skill.

The main editor uses a matte dark theme, a narrow sidebar, subtle borders, restrained blue accents and consistent spacing. All interface copy is in Portuguese. The current profile is kept separately from hardware state: saving a local profile does not send settings. Hardware actions report success only after native confirmation.

## Controllers and lifecycle

`main-controller.ts` and `quick-controller.ts` preserve profile validation, USB IPC, macro capture, media conversion, progress, cancellation, draft recovery and GNOME installation. `controller-runtime.ts` exposes reactive subscriptions through React's `useSyncExternalStore`. Listeners and timers are disposed when a window closes. Controllers remain independent of Darwin's components, so UI refinements do not need to modify the transport.

The editor locks controls during hardware operations, including custom select popovers and sliders. Macro recording has a stable ref and captures only its focused area. The native backend still creates WebViews on demand and destroys them when the editor closes.

## GNOME menu

`gnome/s75-studio@luisdev.local/` remains a real GNOME Shell extension built with St and PopupMenu. React/web components cannot be mounted in a native Shell popover. Keeping it native preserves anchoring to the top bar and avoids retaining a WebView in memory. Darwin UI is used by all Tauri web screens, including the compact fallback. Extension v3 adds battery status.

## Verification

- `npm run build`: TypeScript + production frontend.
- `npm run test:render`: actual React/Darwin rendering of all eight screens and key states, without a display.
- `npm run test:quick`: controller/IPC flow checks: ACK, error, drop-to-upload, cancellation, global/individual lighting, drafts and listener cleanup.
- `npm run test:native-menu`: native GNOME controller and battery behavior with toolkit/IPC doubles.
- `npm test`, `cargo test --offline --workspace`: media, profiles, protocol and native checks.
- `npm run test:ui`: Playwright interaction/screenshots, requires a desktop environment that permits launching Chrome. This sandbox blocks that launch; do not treat the render tests as visual or live hardware confirmation.

## Battery

Bluetooth reads BlueZ Battery1 when the keyboard exposes it; the 2.4 GHz receiver uses the documented battery request on its vendor interface. Unknown readings remain unavailable, never a fabricated percentage. The known wired USB configuration protocol does not report battery percentage. These radio readings still need validation with the actual keyboard in each mode.
