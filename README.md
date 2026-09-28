# Hoop Stats

Hoop Stats is a small web app for iPhone that lets a parent record their daughter's basketball stats during a game with big one-tap buttons, then review a report for each game and totals for the season. It works fully offline and keeps everything on the phone itself: no account, and no signal needed once it's installed. The only thing that ever goes over the network is an optional backup, encrypted end to end, to the project's own backup server.

## Put it on your iPhone

1. Open **https://richshaw.github.io/Basketball/** in **Safari**.
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. Always open Hoop Stats from its home-screen icon. iOS keeps a home-screen app's data separate from Safari's, so stats recorded in one don't show up in the other.

After the first load, the app works with no signal at all (handy in gyms with bad reception). When a new version is ready, the Games, Stats and Settings screens show a **New version available** banner; tap **Update** between games.

## Development

You need Node 22 (see `.nvmrc`).

```sh
npm install           # install dependencies
npm run dev           # dev server at http://localhost:5173
npm test              # unit tests (Vitest); npm run test:watch to re-run on save
npm run e2e           # end-to-end tests in an iPhone-sized Chromium (Playwright)
npm run screenshots   # PNG of every screen, light and dark (SCREENSHOT_DIR, default ./screenshots)
npm run lint          # ESLint
npm run format        # Prettier (npm run format:check only checks)
npm run typecheck     # TypeScript
npm run build         # production build in dist/
npm run preview       # serve the production build
```

The first time you run Playwright on a new machine, install its browser with `npx playwright install chromium`. The service worker (offline support) only runs in the production build, so use `npm run build && npm run preview` to try it.

Pull requests run CI (lint, formatting, types, unit tests, build and end-to-end tests). Every push to `main` deploys to GitHub Pages; in the repository settings, **Pages → Source** must be set to **GitHub Actions**.

Conventions for contributors (and coding agents) are in [CLAUDE.md](CLAUDE.md).
