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
  data/                    the data layer: model types, Dexie database, repository, hooks, stats math,
                           backup format, demo data (see "Data layer" below)
  lib/                     pure helpers: no React, no DOM (e.g. cx, color, court, format, id)
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

## Data layer

Everything is stored on the phone in IndexedDB, through Dexie, in `src/data/`. Import from the module you need (there's no barrel file).

**Always go through `repo.ts` to write, and `hooks.ts` (or `repo.ts` getters) to read. Never touch `db` directly from screens**: the repository keeps records valid and keeps the change markers the backup depends on.

### Model (`data/types.ts`)

- Stats are **event-sourced**. A `Game` plus its `StatEvent`s is the whole record: each tap on the live game screen adds one event (`type`, `period`, `createdAt`, plus `location` on some 2PT/3PT shots). Box scores, period splits and season numbers are always derived from the events by `data/stats.ts`; never store totals.
- There is one `Player` (the daughter). If a game is started before the parent sets the player up, `createGame` creates the player with an empty name, so display it with `formatPlayerName(player)`.
- `Game.date` is a local calendar date, `'YYYY-MM-DD'`. Make it with `todayLocalISO()` and show it with `formatGameDate()`. Never parse it with `new Date('2026-09-27')`: that's midnight UTC, which is still the day before in the US.
- `Game.currentPeriod` is 1-based; anything past regulation (4 quarters or 2 halves) is overtime. Label periods with `periodLabel(period, game.periodFormat)`. `Game.status` is `'live'` or `'final'`; the final score lives in `teamScore` and `opponentScore`.
- Timestamps are epoch ms. Ids are opaque strings. `TEXT_LIMITS` gives the `maxLength` for each text field.
- `CourtPoint` is a shot location in **feet**. The origin is the center of the basket, +x points to the right sideline (as seen from half court facing the basket) and +y points toward half court. The baseline is at y = -5.25, the sidelines at x = ±25 and the half-court line at y = 36.75. `lib/court.ts` has the NFHS geometry: `isThreePoint`, `shotZone` ('paint' | 'midrange' | 'three'), `shotDistanceFt`, `clampToHalfCourt`, and named constants for drawing the court.

### Reading: hooks (`data/hooks.ts`)

Each hook re-renders when its data changes, whoever changed it. **`undefined` means still loading and `null` means not found.** Lists are arrays, never null.

- `usePlayer()`: the player, or null before there is one.
- `useGames()`: every game, newest first (date desc, then createdAt desc).
- `useGame(id)`: one game, or null. `id` may be undefined (straight from `useParams()`); switching ids shows "loading", never the previous game.
- `useGameEvents(id)`: that game's events, oldest first (`[]` for a missing game).
- `useLiveGame()`: the live game updated most recently, or null.
- `useSeasons()`: distinct season labels, most recent first.
- `useSettings()`: settings with defaults filled in.
- `useAllEvents()`: every event of every game, for season stats.

### Writing: repository (`data/repo.ts`)

Each write runs in one transaction. It validates what it stores, bumps the game's `updatedAt` and bumps `meta.lastChangeAt` (which the backup watches), then resolves to the saved record. Bad input rejects with a `TypeError` (validate forms first: empty opponent, invalid date, a location on a non-shot…), and an unknown game id rejects with `Error('Game not found: …')`. Getters resolve to `undefined` when a record is missing.

- `getPlayer()` / `savePlayer({ name, jerseyNumber? })`: creates the single player or updates it. An empty jersey number clears it.
- `createGame({ opponent, date, season?, homeAway?, periodFormat })`: a live game in period 1. It also remembers the period format (and the season, when given) as the defaults for the next new game.
- `updateGame(id, patch)`: changes opponent, date, season, homeAway, periodFormat, teamScore, opponentScore or notes. Keys left out keep their value; `null` clears an optional field.
- `setCurrentPeriod(gameId, period)`: 1 to `MAX_PERIOD` (20).
- `recordStat(gameId, type, location?)`: resolves to the new `StatEvent`, in the game's current period. `createdAt` strictly increases within a game, even for taps in the same millisecond, so order and undo are exact; firing taps without awaiting them is safe. `location` is only allowed on `fg2_*` / `fg3_*` and is clamped onto the court. Works on final games too, for corrections.
- `setStatLocation(eventId, location | null)`: sets or clears a recorded shot's location. For a shot chart that asks for the spot after the stat is saved, so the tap itself is never lost. Resolves to undefined if the stat is gone.
- `undoLastStat(gameId)` / `deleteStat(eventId)`: remove the game's latest event, or one event. Each resolves to the removed event, or undefined.
- `endGame(gameId, { teamScore?, opponentScore? })`: final, with `endedAt`. `reopenGame(gameId)`: live again (scores kept). `deleteGame(gameId)`: the game and all its events.
- `getGame(id)`, `listGames()`, `getLiveGame()`, `getGameEvents(gameId)`, `getAllEvents()`, `listSeasons()`: promise versions of the hooks.
- `getSettings()` / `updateSettings(patch)`: `shotChart` (default true), `defaultPeriodFormat` (default 'quarters') and `lastSeason`.
- `getLastChangeAt()`: when the data last changed (for the backup; read it before exporting).

### Stats math (`data/stats.ts`, pure)

- `STAT_DEFS[type]` is the single source of truth for buttons, the event log and reports. It has `label` ('2PT Made', 'Off Reb', 'Charge Taken'), `shortLabel` ('Made 2', 'OReb'), `kind` ('made' | 'miss' | 'other', for colors), `points` and `shot`. `STAT_TYPES` gives the order.
- `computeStatLine(events)`: a `StatLine` with `pts, fgm, fga, fg2m, fg2a, fg3m, fg3a, ftm, fta, oreb, dreb, reb, ast, stl, blk, tov, pf, deflections, charges`. FG counts 2PT plus 3PT, never free throws. `emptyStatLine()` and `addStatLines(a, b)` round it out.
- `statLinesByPeriod(events, game)`: `[{ period, label, line }]` for every period through the current one, empty periods included.
- `percentage(made, attempted)`: 0-100, or null with no attempts. Show it with `formatPct`.
- `gameResult(game)`: 'W', 'L' or 'T', or null unless the game is final with both scores.
- `statLinesForGames(games, events)`: `[{ game, line }]`. `summarizeGames(entries)` turns those into games played, record, totals, per-game averages, shooting percentages, and highs (`{ value, gameId }`, with ties going to the earliest game). Pass only the games you want, e.g. the final games of one season.

### Formatting (`lib/format.ts`)

- `todayLocalISO()`.
- `formatGameDate('2026-09-27')` gives 'Sun, Sep 27' (`{ withYear: true }` adds ', 2026').
- `formatPct(45.4)` gives '45%' (null gives '–').
- `formatAvg(12.34)` gives '12.3'.
- `formatMadeAttempted(5, 9)` gives '5/9'.
- `formatPlayerName(player)`.

### Backups, demo data and storage

- `data/transfer.ts`:
  - `exportAll()` returns an `ExportFile`: `{ app: 'hoop-stats', schemaVersion: 1, exportedAt, players, games, events, settings }`.
  - `parseExportFile(jsonTextOrObject)` validates it strictly and throws `ExportFileError`, whose `message` is written for the parent.
  - `importAll(file, 'replace' | 'merge')` runs in one transaction: all or nothing. `merge` keeps the most recently updated copy of each game, adds missing events and never deletes anything.
  - `clearAllData()`.
  - A round trip through JSON is exact. Settings are part of the export; `meta.lastChangeAt` isn't.
- `data/demo.ts`: `seedDemoData({ today?, liveGame? })` replaces all data with "Ava" #12 and ten final "Fall 2026" games. Their ids run from `demo-game-01` (oldest) to `demo-game-10`, and `demo-live` is the optional live game in Q3.
- `data/persistence.ts`: `requestPersistentStorage()` (called once at startup) and `getStorageStatus()` (`{ persisted, usage?, quota? }`).
- `window.hoopStats` (`{ seedDemoData, clearAllData, exportAll }`) is installed in every build, for the console, e2e tests and screenshots.
- Other modules (e.g. the cloud backup) may keep their own state in the `meta` table under their own keys. `clearAllData` leaves those alone.

### Changing the schema

- To add a field, update its interface in `types.ts` **and** its schema in `validation.ts`. Typecheck fails until they match, so a backup can never silently drop the field. Add a Dexie index only if you query by it.
- To change indexes or migrate stored data, add `this.version(n + 1)` in `db.ts`. Never edit a version that has shipped.
- To change the backup format, bump `EXPORT_SCHEMA_VERSION` and upgrade older files in `parseExportFile`.

## Testing

- Unit-test logic in `src/lib/` and `src/data/` with plain Vitest, stats math most of all.
- Test screens and components with Testing Library, querying by role and name like a user would. `renderRoute(paths.x)` renders the whole app at a route; `renderWithRouter(<Thing />)` renders one component inside a router. Both live in `src/test/render.tsx`.
- `fake-indexeddb/auto` is loaded in the test setup, so Dexie runs in unit tests. The setup empties the database before every test, so seed data in `beforeEach` or in the test itself (never `beforeAll`), through `repo.ts` or `importAll`. To freeze time, fake only `Date`: `vi.useFakeTimers({ toFake: ['Date'], now })`. Faking every timer stalls IndexedDB.
- jsdom can't open a `<dialog>`, so `src/test/dialogPolyfill.ts` stands in for `showModal`, `close` and Escape; `e2e/ui-kit.spec.ts` checks sheets in a real browser. Closing a sheet finishes asynchronously: wait with `waitFor` or a `findBy` query.
- The toast area is `getByRole('status', { name: 'Notifications' })` and is always on screen, so give your own status messages a name or query them by text.
- End-to-end tests cover key flows. They build the app and serve it under `/Basketball/`, like GitHub Pages. For data, use `e2e/support/data.ts`: `await seedDemoData(page)` after `page.goto('./')`, then navigate (e.g. to `paths.gameReport(demoGameId(10))`).
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
