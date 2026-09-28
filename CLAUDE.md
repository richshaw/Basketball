# Hoop Stats: guide for contributors and agents

Offline-first iPhone web app (PWA). A parent records their daughter's basketball stats during games with big one-tap buttons, then reviews per-game and season reports. Read this before you change anything, and follow the conventions already in the code.

## Product principles

- **Fast one-tap entry during games.** Recording a stat is one tap on a big button: no confirm dialogs, no typing, no scrolling on the live game screen. Offer undo instead of asking "are you sure?".
- **Fully offline-first.** After the first load, everything works completely with no network. No CDNs, web fonts, analytics or other third-party requests.
- **Data lives on the device** (IndexedDB), with no accounts. The only network use allowed is the optional, end-to-end-encrypted, best-effort backup to the project's own backup server (`server/`, added in PR #2). Nothing else may call the network, and the app never waits on it.
- **Never lose data.** Save every tap immediately. Never rely on a later "save" step, on the page staying open, or on in-memory state.
- **Never interrupt a live game.** Nothing may pop up, navigate away or reload on the tracking screen. That's why the update banner lives only in the tab-screen shell.
- **No zooming on the game screen.** Its root element sets `touch-action: manipulation` (not just its buttons), so fast taps between buttons can't double-tap-zoom.
- **Resume after a relaunch.** iOS may relaunch the app at `start_url` in the middle of a game, so the Games screen must offer to resume the live game.

## Stack

- Vite 8, React 19, TypeScript 6 (`strict` plus `noUncheckedIndexedAccess`), npm (commit `package-lock.json`).
- react-router 7 in data mode with a **hash router** (`#/stats`): GitHub Pages has no SPA rewrites, and hash URLs always load the cached `index.html` offline.
- vite-plugin-pwa (generateSW, `registerType: 'prompt'`) precaches the whole build.
- Plain CSS: design tokens in `src/styles/tokens.css` plus one CSS Module per component. No Tailwind, no UI library.
- Vitest + jsdom + Testing Library for unit tests. Playwright (Chromium at iPhone size) for end-to-end tests and screenshots.
- ESLint flat config (type-aware typescript-eslint, react-hooks, react-refresh) + Prettier.
- Deployed to https://richshaw.github.io/Basketball/ by `.github/workflows/deploy.yml`. `base: './'` keeps every asset URL relative.

## Folder structure

```text
src/
  main.tsx, App.tsx        entry point; App mounts the service-worker provider and the router
  router.tsx               the route table (appRoutes), shared by the app and the tests
  routes.ts                routePatterns + paths.*: the only place URLs are built
  components/<Name>/       shared UI: <Name>.tsx, <Name>.module.css, <Name>.test.tsx
  screens/<Feature>/       one folder per screen: <Feature>Screen.tsx, .module.css, tests, screen-only parts
  data/                    (next PR) Dexie database, types, stats math, hooks
  lib/                     pure helpers: no React, no DOM (e.g. cx, color)
  pwa/                     service worker registration and app-update state
  styles/                  tokens.css (design tokens), global.css (element defaults, utilities)
  test/                    Vitest setup and render helpers
e2e/                       Playwright specs; e2e/support/ holds shared helpers
public/                    icon.svg and the icons generated from it (npm run generate-pwa-assets)
```

Keep changes inside your own screen folder where you can. Code used by more than one screen goes in `components/` (UI), `lib/` (pure logic) or `data/` (storage and stats).

## Routing

- Build every URL with `paths.*` from `src/routes.ts`, e.g. `paths.trackGame(game.id)`. Never hand-build a URL string.
- To add a route, add it to `routePatterns` and `paths`, then to `appRoutes` in `src/router.tsx`.
- Tab screens (Games `/`, Stats `/stats`, Settings `/settings`) render inside `AppShell` (content, update banner, tab bar). Full-screen routes (new game, game report, live tracking) render without it.
- Navigate with `<Link>`, `<ButtonLink>` or `useNavigate()`. Unknown paths redirect to Games.

## Styling

- Use tokens only: `var(--space-4)`, `var(--color-text-muted)`, `var(--radius-lg)`. No raw colors, sizes or font stacks in component CSS. If a token is missing, add it to `tokens.css`.
- Colors: `--color-x` is a fill, `--color-on-x` is text on that fill, `--color-x-text` is that hue as text on `bg` / `surface` / `surface-2`. Both themes follow the system light/dark setting. `src/styles/tokens.test.ts` checks every text/background pair for WCAG AA contrast; add new pairs there.
- One CSS Module per component, camelCase class names (`styles.titleRow`). Combine classes with `cx()` from `src/lib/cx.ts`.
- Every tappable element is at least 44x44px (`--tap-target`); main actions use 56px (`--tap-target-lg`). Game-screen buttons should be much bigger, with big, bold type (`--font-size-xl` and up, `--font-size-display` for scores). Put `.tabular-nums` on numbers that change.
- The status bar is black (`black` style), and the page starts below it. `ScreenHeader` pads the top safe-area inset (0 there), `TabBar` the bottom one (home indicator) and `body` the sides. Put screen content in `ScreenBody`: it adds the page padding and, on full-screen routes, clears the home indicator.
- Reach for the [shared components](#shared-components) before writing new basics. Add icons as inline SVG components in `src/components/Icons/Icons.tsx`.

## Shared components

Each lives in `src/components/<Name>/`. See them all, in their main states, at `#/dev/ui` (a hidden gallery that `npm run screenshots` also captures); add new shared components there too.

- `Button` / `ButtonLink`: variants `primary`, `secondary`, `danger`, `ghost`; sizes `md` (44px), `lg` (56px); `block`. Use `ButtonLink` when the action is navigation.
- `ScreenHeader`, `ScreenBody`, `Card`, `EmptyState`: the screen title (optional back link and action), the padded content area (clears the home indicator on full-screen routes), a rounded surface, and the "nothing here yet" placeholder.
- `SegmentedControl<T>`: pick one of 2–4 options: `options`, `value`, `onChange`, `aria-label` (or `aria-labelledby`), `size`. It's a radio group, so the arrow keys work.
- `TextField` / `TextArea`: a labelled field with `hint` and `error` (wired to aria-describedby and aria-invalid). Takes every native prop (`type`, `inputMode`, `enterKeyHint`, ...); `suggestions` adds a datalist.
- `Sheet`: bottom sheet on `<dialog>`: `open`, `onClose`, `title`, `description`, `footer`. The X, Escape and a tap on the dimmed page all call `onClose`; `dismissible={false}` leaves only the sheet's own buttons (use it for forms).
- `ConfirmDialog` / `useConfirm()`: `if (await confirm({ title, message, confirmLabel: 'Delete game', destructive: true }))`. Prefer undo; confirm only what can't be undone.
- `useToast()`: `toast.show({ message, actionLabel: 'Undo', onAction })`. One at a time, 4 s by default; it floats above the tab bar and home indicator, and only its action takes taps. Toasts vanish, so never make one the only way to do something.
- `GroupedList` + `ListRow`: iOS inset grouped list (`header`, `footer`). Rows take `title`, `subtitle`, `value` (text or a `Badge`), `icon`, `chevron`, `destructive`, and `to` (link) or `onClick` (button) or neither (static).
- `StatTable`: table of numbers: `caption`, `columns` (`{ key, header, fullLabel?, align?, width? }`), `rows`, `totalRow`, `highlightedRow`. Wide tables scroll sideways under a sticky first column.
- `StatTileGrid` + `StatTile`: big-number tiles (`value`, `label`, `fullLabel`, `detail`, `highlight`), four across on most iPhones (`columns` fixes the count).
- `Badge`: small pill label; `tone` is `neutral`, `accent`, `made`, `miss` or `stat`.
- `shareText({ title, text })` in `src/lib/share.ts`: the share sheet, else the clipboard. Resolves to `'shared' | 'cancelled' | 'copied' | 'failed'` and never throws; call it straight from a tap.

`App` mounts `UiProviders` (toasts and confirmations) once at the root, and the test render helpers include it. A toast shown while a sheet is open appears inside the sheet, at the top. `TabBar` raises `--overlay-inset-bottom` so toasts clear it; a screen with its own bottom bar can do the same.

## Testing

- Unit-test logic in `src/lib/` and `src/data/` with plain Vitest, stats math most of all.
- Test screens and components with Testing Library, querying by role and name like a user would. `renderRoute(paths.x)` renders the whole app at a route; `renderWithRouter(<Thing />)` renders one component inside a router. Both live in `src/test/render.tsx`.
- `fake-indexeddb/auto` is loaded in the test setup, so Dexie runs in unit tests.
- jsdom can't open a `<dialog>`, so `src/test/dialogPolyfill.ts` stands in for `showModal`, `close` and Escape; `e2e/ui-kit.spec.ts` checks sheets in a real browser. Closing a sheet finishes asynchronously: wait with `waitFor` or a `findBy` query.
- The toast area is `getByRole('status', { name: 'Notifications' })` and is always on screen, so give your own status messages a name or query them by text.
- End-to-end tests cover key flows. They build the app and serve it under `/Basketball/`, like GitHub Pages.
- Add each new screen to `e2e/screenshots.spec.ts` (one line), run `npm run screenshots`, and look at the PNGs in light and dark mode.
- @playwright/test is pinned to exactly 1.56.1 to match the preinstalled Chromium. Don't run `playwright install` in the agent environment; CI installs its own browser.

## Before you push

```sh
npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run e2e
```

## Gotchas

- The service worker runs only in the production build (`npm run build && npm run preview`), never in `npm run dev`.
- `npm run e2e` builds and serves this checkout on `E2E_PORT` (default 4173) and fails if the port is taken: parallel worktrees must use distinct `E2E_PORT` values.
- Build output and `public/` files are precached only if their extension is in `workbox.globPatterns` (`vite.config.ts`). Add new file types there.
- An app update reloads only the window where the user tapped Update (`src/pwa/updates.ts`). Nothing else may reload the page.
- In Vitest, `react-router/dom` is aliased to `react-router` (see `vite.config.ts`) so tests never load two copies of the router.
