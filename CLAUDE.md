# Hoop Stats: guide for contributors and agents

Offline-first iPhone web app (PWA). A parent records their daughter's basketball stats during games with big one-tap buttons, then reviews per-game and season reports. Read this before you change anything, and follow the conventions already in the code.

## Product principles

- **Fast one-tap entry during games.** Recording a stat is one tap on a big button: no confirm dialogs, no typing, no scrolling on the live game screen. Offer undo instead of asking "are you sure?".
- **Fully offline-first.** After the first load, everything works completely with no network. No CDNs, web fonts, analytics or other third-party requests.
- **Data lives on the device** (IndexedDB), with no accounts. The only network use allowed is the optional, end-to-end-encrypted, best-effort backup to the project's own backup server (`server/`, added in PR #2). Nothing else may call the network, and the app never waits on it.
- **Never lose data.** Save every tap immediately. Never rely on a later "save" step, on the page staying open, or on in-memory state.
- **Never interrupt a live game.** Nothing may pop up, navigate away or reload on the tracking screen. That's why the update banner lives only in the tab-screen shell.
- **No zooming on the game screen.** Its root element sets `touch-action: pan-x pan-y` (not just its buttons), so fast taps between buttons can't double-tap-zoom and a stray pinch can't zoom either. Its sheets sit outside that element, so they still scroll.
- **Every tap counts exactly once on the game screen.** A double tap on Undo or Next acts once, and the line's Undo ignores taps for a moment after an Undo (never after a stat, so "wrong stat, Undo" stays quick). Each tap is written to the pending-stats journal (`src/data/pendingStats.ts`, in localStorage) before its save starts, and saved under an id made at the tap: a stat that couldn't be saved stays on screen, is retried until it is, is still saved after a relaunch, and is never saved twice. Undo goes by tap time and never says it removed a stat that was already gone (`src/screens/TrackGame/session.ts`).
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
                           backup format, demo data (see "Data layer" below); data/backup/ is the
                           encrypted cloud backup (see "Cloud backup")
  lib/                     pure helpers, plus thin guarded wrappers over browser APIs: no React,
                           no DOM elements (e.g. cx, color, court, format, id, share)
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
- `Sheet`: bottom sheet on `<dialog>`: `open`, `onClose`, `title`, `description`, `footer`, `onClosed`. The X, Escape and a tap on the dimmed page all call `onClose`; `dismissible={false}` leaves only the sheet's own buttons (use it for forms). Closing gives the page back at once (focus returns), then `onClosed` fires once the sheet has slid away. It rides above the iPhone keyboard, and a `ConfirmDialog` inside it closes without closing the sheet.
- `ConfirmDialog` / `useConfirm()`: `if (await confirm({ title, message, confirmLabel: 'Delete game', destructive: true }))`. Prefer undo; confirm only what can't be undone. One question at a time: a `confirm()` asked while a dialog is on screen opens once that one has closed, with focus on its safe button.
- `useToast()`: `toast.show({ message, actionLabel: 'Undo', onAction, duration, placement })` returns an id for `toast.hide(id)`; `actionLabel` and `onAction` come together. One at a time, 4 s by default; it floats above the home indicator, tab bar and update banner (`placement: 'top'` puts it under the header bar instead), and only its action takes taps. After a toast's action runs (or it times out) it stays 350 ms, catching taps, so a double tap can't reach what's underneath; a toast shown meanwhile waits. Toasts vanish, so never make one the only way to do something. **Screens with controls along the bottom (the live game screen) show tap feedback inline, not in a toast.**
- `GroupedList` + `ListRow`: iOS inset grouped list (`header`, `footer`). Rows take `title`, `subtitle`, `value` (text or a `Badge`), `icon`, `chevron`, `destructive`, and `to` (link) or `onClick` (button) or neither (static).
- `StatTable`: table of numbers: `caption`, `columns` (`{ key, header, fullLabel?, align?, width? }`), `rows`, `totalRow`, `highlightedRow` (read to screen readers as "current", or your `highlightLabel`), `rowKey`. Wide tables scroll sideways under a sticky first column. `linkedRows` makes each body row one tap target that follows the first link in the row: put a `Link` in every row (e.g. the first column), since that's what keyboard and screen reader users reach. Modified clicks (⌘/Ctrl/Shift/Alt) are left to the browser.
- `StatTileGrid` + `StatTile`: big-number tiles (`value`, `label`, `fullLabel`, `detail`, `highlight`), four across on most iPhones (`columns` fixes the count).
- `Badge`: small pill label; `tone` is `neutral`, `accent`, `made`, `miss` or `stat`.
- `InstallBanner` / `InstallSheet`: the "Add to Home Screen" nudge. `AppShell` renders the banner, which shows only in iPhone Safari (not in the installed app) and stays away 14 days once dismissed; the sheet has the steps (Settings opens it too). `InstallBannerView` is the banner alone, always shown.
- `shareText({ title, text })` in `src/lib/share.ts`: the share sheet, else the clipboard. Resolves to `'shared' | 'cancelled' | 'copied' | 'failed'` and never throws; call it straight from a tap. `shareFile(file)` shares just a file, resolving to `'shared' | 'cancelled' | 'unavailable'` (then offer it another way, e.g. a download).

`App` mounts `UiProviders` (toasts and confirmations) once at the root, and the test render helpers include it. A toast shown while a sheet is open appears inside the sheet, under its header. `TabBar` and the update banner raise `--overlay-inset-bottom` so toasts clear them; a screen with its own bottom controls can set it on `:root` too.

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

Each write runs in one transaction. It validates what it stores, bumps the game's `updatedAt` and bumps `meta.lastChangeAt` (which the backup watches), then resolves to the saved record. A write that changes nothing (undo with nothing to undo, a missing id) doesn't bump anything. Bad input rejects with a `TypeError` (validate forms first: empty opponent, invalid date, a location on a non-shot…), and an unknown game id rejects with `Error('Game not found: …')`. Getters resolve to `undefined` when a record is missing.

**Changing a field, everywhere** (`updateGame`, `endGame`, `savePlayer`'s jersey number, `updateSettings`, `setStatLocation`): a field that's missing or `undefined` keeps its value; `null` or `''` clears it. Clearing a required field (opponent, date) is rejected.

- `getPlayer()` / `savePlayer({ name, jerseyNumber? })`: creates the single player or updates it. Leaving out the jersey number keeps it.
- `createGame({ opponent, date, season?, homeAway?, periodFormat })`: a live game in period 1. It also remembers the period format (and the season, when given) as the defaults for the next new game.
- `updateGame(id, patch)`: changes opponent, date, season, homeAway, periodFormat, teamScore, opponentScore or notes.
- `setCurrentPeriod(gameId, period)`: 1 to `MAX_PERIOD` (20).
- `recordStat(gameId, type, location?, { id?, at?, period? })`: resolves to the new `StatEvent`, in the game's current period, or in `period` when it's given (checked like `setCurrentPeriod`; the game's current period doesn't change). Pass the period that was on screen at the tap, so a tap right after "Next period" lands where the parent saw it. Pass the `id` and tap time `at` made at the tap too (see `pendingStats.ts`): saving is then idempotent (a stat already saved under that id comes back as it is, and nothing is written or bumped, so a retry after a write that only seemed to fail can't add it twice), and `at` becomes its `createdAt`, so it sorts where it was tapped however late it's saved. No two stats of a game share a `createdAt` (a taken `at` moves to the free millisecond just after it, or else just before it, so it keeps its place between the stats tapped before and after it; only if both are taken too does it move on past them; without `at` it's just after the game's latest stat, even in the same millisecond), so order and undo are exact. `location` is only allowed on `fg2_*` / `fg3_*` and is clamped onto the court; a location that isn't a real point (NaN or Infinity, e.g. from a court measured at zero size) is dropped and the stat is still saved. Works on final games too, for corrections.
- **Fire-and-forget writes** (e.g. `void recordStat(…)` on each tap) are saved in call order, but a `void` promise hides its failure. Add `.catch()` and surface the error (e.g. a toast), so a tap that wasn't saved never goes unnoticed.
- `setStatLocation(eventId, location | null)`: sets or clears a recorded shot's location. For a shot chart that asks for the spot after the stat is saved, so the tap itself is never lost. Resolves to undefined if the stat is gone; a point that isn't real rejects (the stat stays saved).
- `undoLastStat(gameId)` / `deleteStat(eventId)`: remove the game's latest event, or one event. Each resolves to the removed event, or undefined.
- `endGame(gameId, { teamScore?, opponentScore? })`: final, with `endedAt`. `reopenGame(gameId)`: live again (scores kept). `deleteGame(gameId)`: the game and all its events.
- `getGame(id)`, `listGames()`, `getLiveGame()`, `getGameEvents(gameId)`, `getAllEvents()`, `listSeasons()`: promise versions of the hooks.
- `getSettings()` / `updateSettings(patch)`: `shotChart` (default true), `defaultPeriodFormat` (default 'quarters') and `lastSeason`.
- `getLastChangeAt()`: when the data last changed (for the backup; read it before exporting).
- `subscribeToChanges(listener)`: calls `listener` the moment any write commits (this tab or another), before the hooks re-read; returns a function that stops it. For code that keeps its own copy of the data, like the backup file Settings prepares so the share sheet can open straight from a tap.

### Taps not saved yet (`data/pendingStats.ts`, `data/pendingSaves.ts`)

The live game screen keeps every stat tap that isn't confirmed saved in a small journal in localStorage, so no tap depends on the page staying open or on IndexedDB answering (WebKit can lose its IndexedDB connection while the app is in the background, and then every write fails until it's back or the page reloads). `pendingStats.ts` is the journal itself and never touches the database; `pendingSaves.ts` saves what it holds.

- One key per tap, `hoop-stats.pendingStat.<id>`, holding `{ id, gameId, type, period, at, location? }`: no write ever rewrites the others. It's written synchronously at the tap, before the IndexedDB write starts, and removed once the save is confirmed or the tap is undone.
- `newPendingStat({ gameId, type, period, location? }, after?)` makes a tap: its stat's `id` and its tap time `at` (`nextTimestamp` after the latest stat or tap, so taps keep their order). `savePendingStat(stat)` (`pendingSaves.ts`) saves it through `recordStat` with that `id` and `at`: idempotent, so saving a tap twice is still one stat.
- `addPendingStat(stat)` (false if it couldn't be kept), `removePendingStat(id)`, `isPendingStat(id)` and `listPendingStats(gameId?)` (in tap order; an entry this version can't read is skipped and left alone). They never throw: without localStorage (full, blocked), taps are still saved, just not kept across a reload, and the screen says so.
- `replayPendingStats()` runs from `main.tsx` after the first render, in the background, never blocking or showing anything: it saves each kept tap once and forgets it, keeps one it can't save for next time, drops the taps of games that no longer exist, and saves taps of finished games too. A tracking session also starts with its game's kept taps, listed as not saved (counted, and undoable) until they are.

### Stats math (`data/stats.ts`, pure)

- `STAT_DEFS[type]` is the single source of truth for buttons, the event log and reports. It has `label` ('2PT Made', 'Off Reb', 'Charge Taken'), `shortLabel` ('Made 2', 'OReb'), `kind` ('made' | 'miss' | 'other', for colors), `points` and `shot`. `STAT_TYPES` gives the order. For a type read from stored data, use `statDefOf(type)`: it's undefined for a type this version doesn't know (e.g. from a newer app).
- `computeStatLine(events)`: a `StatLine` with `pts, fgm, fga, fg2m, fg2a, fg3m, fg3a, ftm, fta, oreb, dreb, reb, ast, stl, blk, tov, pf, deflections, charges`. FG counts 2PT plus 3PT, never free throws. `emptyStatLine()` and `addStatLines(a, b)` round it out.
- `statLinesByPeriod(events, game)`: `[{ period, label, line }]` for every period through the current one, empty periods included.
- `percentage(made, attempted)`: 0-100, or null with no attempts. Show it with `formatPct`. It's exact at a true .5 (23/40 is 57.5, shown as 58%), so don't compute `(made / attempted) * 100` yourself.
- `gameResult(game)`: 'W', 'L' or 'T', or null unless the game is final with both scores.
- `statLinesForGames(games, events)`: `[{ game, line }]`. `summarizeGames(entries)` turns those into games played, record, totals, per-game averages (rounded half up to one decimal from the totals: 17 in 20 games is 0.9), shooting percentages, and highs (`{ value, gameId }`, with ties going to the earliest game). Pass only the games you want, e.g. the final games of one season.

### Formatting (`lib/format.ts`)

- `todayLocalISO()`.
- `formatGameDate('2026-09-27')` gives 'Sun, Sep 27' (`{ withYear: true }` adds ', 2026'; `{ weekday: false }` gives 'Sep 27'). Use it for every game date; it's cheap to call in lists.
- `formatPct(45.4)` gives '45%' (null gives '–').
- `formatAvg(12.34)` gives '12.3' (rounded half up, so `formatAvg(17 / 20)` is '0.9').
- `formatMadeAttempted(5, 9)` gives '5/9'.
- `pad2(7)` gives '07' (e.g. for clock times).
- `formatPlayerName(player)`.

### Backups, demo data and storage

- `data/transfer.ts`:
  - `exportAll()` returns an `ExportFile`: `{ app: 'hoop-stats', schemaVersion: 1, exportedAt, players, games, events, settings }`.
  - `parseExportFile(jsonTextOrObject)` validates it strictly and throws `ExportFileError`, whose `message` is written for the parent.
  - `importAll(file, 'replace' | 'merge')` runs in one transaction: all or nothing. `replace` makes the device hold exactly the file's data.
  - `merge` treats a game and its events as one unit: whichever copy was updated most recently wins, events and all. A newer copy in the file replaces that game's events (so stats deleted or moved there come across); an older or equally old copy is skipped with its events (so stats undone on the phone stay undone). Games on only one side are kept, so **a merge brings back games that were deleted on the phone** (fine for a restore). One player is kept, and the phone keeps its own settings.
  - `meta.lastChangeAt` only moves when an import actually changed something.
  - `clearAllData()`.
  - A round trip through JSON is exact. Settings are part of the export; `meta.lastChangeAt` isn't.
- `data/demo.ts`: `seedDemoData({ today?, liveGame?, force?, keepSettings? })` replaces all data with "Ava" #12 and ten final "Fall 2026" games (`keepSettings` keeps the device's own settings). Their ids run from `demo-game-01` (oldest) to `demo-game-10`, and `demo-live` is the optional live game in Q3; `isDemoGameId(id)` tells them apart. It refuses to replace a device's own data (anything but earlier demo data) unless `force: true`; a fresh Playwright context starts empty, so tests don't need it.
- `data/persistence.ts`: `requestPersistentStorage()` (called once at startup) and `getStorageStatus()` (`{ persisted, usage?, quota? }`).
- `window.hoopStats` (`{ seedDemoData, clearAllData, exportAll, backup }`) is installed in every build, for the console, e2e tests and screenshots; `backup` is the cloud backup's API (below).
- Other modules may keep their own state in the `meta` table under their own keys, as the cloud backup does (`cloudBackup`). `clearAllData` leaves those alone.

### Changing the schema

- To add a field, update its interface in `types.ts` **and** its schema in `validation.ts`. Typecheck fails until they match, so this version's backups can never silently drop the field. A new setting also needs its default in `DEFAULT_SETTINGS` (`repo.ts`) unless it's optional.
- **Any change to what a record can hold** (a new field, a new allowed value such as a stat type or period format, a looser limit) **must bump `EXPORT_SCHEMA_VERSION`** in `transfer.ts`, and `parseExportFile` must learn to read the older versions. An older app then tells the parent to update it, instead of silently dropping the new data (it strips fields it doesn't know) or calling a good backup damaged.
- Add a Dexie index only if something queries by it: every index is rewritten on every write, and a game is written on every tap.
- To change indexes or migrate stored data, add `this.version(n + 1)` in `db.ts`. Never edit a version that has shipped.

## Cloud backup

Opt-in, end-to-end-encrypted copies of all the data on the project's backup server (`server/`, API in `server/README.md`), in `src/data/backup/`. Screens use only `cloudBackup.ts` (actions) and `hooks.ts` (`useCloudBackupStatus`). The server comes from `VITE_BACKUP_API_URL` at build time (`deploy.yml` sets https://richshaw-hoop-stats.fly.dev); without it `isCloudBackupAvailable()` is false and nothing touches the network.

### API (`data/backup/cloudBackup.ts`)

Network calls resolve to `CloudResult<T>`: `{ ok: true, value }` or `{ ok: false, error: { kind, message, retryAfterMs? } }`. They don't throw for expected failures (no signal, a typo, a busy server): show `error.message` (written for the parent) and branch on `error.kind` if needed.

- `isCloudBackupAvailable()`: a server is configured and WebCrypto works (https or localhost only).
- `enableCloudBackup(): Promise<string>`: turns backup on and starts an upload (watch the status); resolves to the backup code, for the parent to write down. It reuses the code the phone kept when backup was turned off (same code, same cloud copy, no new server account), else makes a new one; if backup is on already, the current code. It waits for a turn-off in progress first. It rejects when cloud backup is unavailable or the phone's storage fails, so catch it.
- `getBackupCode()`: the code (`XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`), also while backup is off with the code kept; undefined when the phone has none.
- `backUpNow({ force? })`: uploads now, also when nothing changed, during a backoff or while paused (use it for "Try again"). Two failures are questions for the parent: `kind: 'shrink'` (games in the last backup aren't on this phone) and `kind: 'other-device'` (another phone backed up with this code since this one did). Ask, then call again with `force: true` ("Back up anyway"): that overrides the pause being shown (and any the parent overrode before without an upload); every other check still runs, so if the other problem turns up it pauses for that one and you ask again. If the check for another phone itself fails (a busy server), a "Back up now" goes ahead anyway: the server keeps earlier versions.
- `fetchCloudBackup(code, { version? })`: downloads and decrypts a backup for a restore preview: `{ file, games, events, exportedAt, createdAt?, version?, size, accountId }`. Show `exportedAt`: it's inside the encrypted data, while `createdAt` is the server's word. Nothing is imported.
- To restore: `importAll(backup.file, 'replace' | 'merge')`, then `enableCloudBackupWithCode(code, { backup })` so this phone carries on backing up under that code (passing `backup` saves a second download). The restored backup's games become the shrink guard's baseline, so a phone without them can't replace it by accident, and the phone carries on from the server's newest version, so restoring an earlier version isn't taken for another phone. If the phone is already on with that code, this clears its pauses: that's how restoring the other phone's backup settles `paused-other-device`.
- `listCloudVersions(code)`: `[{ version, createdAt, size }]`, newest first, for "restore an earlier backup" (then `fetchCloudBackup(code, { version })`).
- `disableCloudBackup({ deleteCloudCopy? })`: stops backing up but keeps the code, so turning backup on again continues the same cloud copy. With `deleteCloudCopy`, the server's copies are deleted and then the phone forgets the code; that needs signal, and if it fails nothing changes and the error says why. It also works while backup is off (deleting the kept code's copy), so an "Erase all data" confirmation can offer to turn backup off too.
- `useCloudBackupStatus()` (`hooks.ts`): `undefined` while loading, then `{ available, enabled, state, lastSuccessAt?, lastError?, nextAttemptAt?, pendingChanges, shrink?, otherDevice? }`. `state` is `idle`, `backing-up`, `waiting-for-signal` (changes wait for a connection), `needs-attention` (automatic backup stopped: the server refused the code (401), the cloud copy was deleted (409, or gone from the server once this phone had backed up) or the data is too big (413); `lastError.message` says which, and `backUpNow()` retries, starting a new cloud copy if it was deleted), `paused-shrink` (`shrink: { backedUpGames, missingGames }`), `paused-other-device` (`otherDevice: { backedUpAt? }`) or `error` (retried at `nextAttemptAt`; a busy server's message says when).
- `parseBackupCode` / `normalizeBackupCode` (`code.ts`) check a typed code offline and throw `BackupCodeError` with a message; the functions above already do it.

### How it works

- **Code** (`code.ts`): 128 random bits as 28 Crockford base32 characters in groups of four; the last two are a Reed-Solomon check, so any one or two typos (or a swap) are caught before a network call. Case, spaces and dashes don't matter; O reads as 0 and I or L as 1.
- **Keys** (`keys.ts`): HKDF-SHA256 over the code's 16 bytes (salt `hoopstats/v1/salt`; info `hoopstats/v1/account-id`, `hoopstats/v1/auth-token`, `hoopstats/v1/enc-key`) gives the account id, the bearer token and a non-extractable AES-GCM-256 key. Never change the labels: every existing backup would become unreadable.
- **Snapshot** (`snapshot.ts`): `HSB1`, a flags byte (bit 0: gzipped), a random 12-byte IV, then AES-GCM of the (gzipped, via CompressionStream when there is one) `exportAll()` JSON, with the header and account id as additional data. Decrypting ends with `parseExportFile`. A new format needs a new magic or flag, which older apps report as "update the app".
- **Scheduler** (`engine.ts`, timings in `policy.ts`, started once by `main.tsx`): checks 3 s after startup, on `online`, when the app becomes visible and after writes (`subscribeToChanges`; while backup is off a write costs one small read). It uploads 20 s after the last change but no more than 60 s after the first. While a game is live it uploads only in a quiet spell (20 s without a tap), at most once a minute, and after 5 minutes of steady tapping at the latest; the startup, online and visible checks and retries wait for a quiet spell too, so uploads rarely compete with taps for the database. A game that ends is backed up 2 s later, and waiting changes go at once when the app is hidden. One upload at a time, also across tabs (the Web Locks API, where there is one). It reads `lastChangeAt` before `exportAll()` and skips when nothing changed since the last upload. Offline (even if the `offline` event was missed), it waits for `online`. Failures back off 1, 2, 5, 15, then every 30 min (longer if the server's Retry-After says so); a connection coming back, the app becoming visible or being hidden retries network failures at once.
- **Shrink guard** (`shrinkCheck` in `policy.ts`): the baseline is the ids of the parent's own games in the last upload (sample games, `isDemoGameId`, never count). An automatic upload is held back (`paused-shrink`) when at least 3 of those games, and at least half, aren't on the phone, when none of them is, or when the backup had stats and the phone has none. New games don't make up for missing ones. It resumes by itself once the games are back (after a restore, say), or with `backUpNow({ force: true })`. It runs before any network request, so a paused phone sends nothing.
- **State** (`state.ts`): the `meta` record `cloudBackup`, one transaction per write, patched with the usual rule (`undefined` keeps, `null` clears): the code, `enabledAt`, `disabledAt` (off, code kept), `lastSuccessAt`, `lastUploadedChangeAt`, `backedUpGameIds` and `backedUpEventCount` (the guard's baseline), `lastVersion`, `pendingUploadSize`, `lastError`, `failures`, `nextAttemptAt`, `paused`, `shrink`, `otherDevice` and `confirmedPauses` (pauses the parent already overrode). It's never in `exportAll()` or a snapshot and never bumps `lastChangeAt`, and **`clearAllData()` keeps it** on purpose: an erased phone stays on the same code, and the shrink guard stops it replacing the good cloud copy. Only a successful `disableCloudBackup({ deleteCloudCopy: true })` removes it.
- **Another phone** with the same code: before replacing the newest backup, an upload asks the server for it (`HEAD …/latest`, while the snapshot is being made) and compares its version with the last one this phone uploaded or restored. If another phone uploaded since, it pauses (`paused-other-device`) instead of overwriting; restoring that backup (then `enableCloudBackupWithCode`) or `backUpNow({ force: true })` resolves it. An upload whose answer was lost or garbled is recognized by its size (`pendingUploadSize`, kept unless the answer proves nothing was stored), not taken for another phone's.

## Testing

- Unit-test logic in `src/lib/` and `src/data/` with plain Vitest, stats math most of all.
- Test screens and components with Testing Library, querying by role and name like a user would. `renderRoute(paths.x)` renders the whole app at a route; `renderWithRouter(<Thing />)` renders one component inside a router. Both live in `src/test/render.tsx`.
- `fake-indexeddb/auto` is loaded in the test setup, so Dexie runs in unit tests. The setup empties the database (and localStorage) before every test, so seed data in `beforeEach` or in the test itself (never `beforeAll`), through `repo.ts` or `importAll`. To freeze time, fake only `Date`: `vi.useFakeTimers({ toFake: ['Date'], now })`. Faking every timer stalls IndexedDB.
- jsdom can't open a `<dialog>`, so `src/test/dialogPolyfill.ts` stands in for `showModal`, `close` and Escape (like browsers, it marks the page outside the top modal `inert` and fires `close` from a queued task); `e2e/ui-kit.spec.ts` checks sheets in a real browser. Closing a sheet or a toast finishes asynchronously: wait with `waitFor` or a `findBy` query.
- The toast area is `getByRole('status', { name: 'Notifications' })` and is always on screen, so give your own status messages a name or query them by text.
- End-to-end tests cover key flows. They build the app and serve it under `/Basketball/`, like GitHub Pages. For data, use `e2e/support/data.ts`: `await seedDemoData(page)` after `page.goto('./')`, then navigate (e.g. to `paths.gameReport(demoGameId(10))`).
- Cloud backup tests use `src/test/fakeBackupServer.ts` (an in-memory copy of the server's API, which e2e specs route into the page with `routeFakeBackupServer` from `e2e/support/backup.ts`; it has no retention, rate limits or disk space) and `src/test/backupHarness.ts` (`createEngineHarness()`: an engine with a manual clock, a fake connection and visibility, and `notify()` for data changes; `buildRealData()` is the demo season under ids that aren't sample ids, since the shrink guard ignores sample games). `src/data/backup/server.node.test.ts` runs the client against the real `server/` app in process, and the same contract against the fake; it needs `npm ci --prefix server` (without it those tests show as skipped, with a test named for the reason, except in CI, where it's an error).
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
- The e2e build's backup server is `https://backup.hoop-stats.test` (`playwright.config.ts`): nothing answers there unless a spec routes it, so no test can reach the real server. `window.hoopStats.backup.setBackupTimingsForTests({ debounceMs: 300 })` shortens the scheduler's waits.
- To try cloud backup locally, run the server (`cd server && ALLOWED_ORIGINS=http://localhost:5173 npm run dev`) and the app with `VITE_BACKUP_API_URL=http://localhost:8080 npm run dev`.
- In Vitest, `react-router/dom` is aliased to `react-router` (see `vite.config.ts`) so tests never load two copies of the router.
