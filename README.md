# TrueAIGaming

A free, public arcade of games built with AI. Every game listed here was made with AI tools and is free to play in the browser.

It's a static site: Vite + vanilla TypeScript, no backend, no accounts, no trackers, no third-party fonts or CDNs. One file, [`public/games.json`](public/games.json), drives the whole thing.

- **Home (`/`)**: a grid of game cards. Each card links straight to the game's live URL (new tab).
- **Play page (`/play.html?id=<game-id>`)**: gives the game the whole screen in an iframe, with a small control pill (back, full screen, open in new tab, feedback) for when embedding doesn't work well. See [Play page sizing](#play-page-sizing).

## Develop

```sh
npm install
npm run dev      # local dev server
npm run build    # type-check + production build to dist/
npm run preview  # serve dist/ locally
```

## Add a game

1. **Add one entry to `public/games.json`:**

   ```json
   {
     "id": "my-game",
     "name": "My Game",
     "description": "One sentence about the game",
     "playUrl": "https://my-game.vercel.app",
     "thumbnail": "/thumbs/my-game.png",
     "status": "live",
     "repo": "https://github.com/you/my-game"
   }
   ```

   | Field         | Notes                                                                                            |
   | ------------- | ------------------------------------------------------------------------------------------------ |
   | `id`          | Unique, URL-safe slug. Used in `play.html?id=…`.                                                 |
   | `name`        | Display name.                                                                                    |
   | `description` | Short one-liner shown on the card.                                                               |
   | `playUrl`     | Live game URL. **Must be `https://`**; entries with other schemes are ignored.                   |
   | `thumbnail`   | Path under `public/`, starting with `/`. Must be local (the CSP only allows same-origin images).  |
   | `status`      | e.g. `live` (green badge) or `beta` (yellow badge); anything else gets a neutral badge.          |
   | `repo`        | Optional source link (`https://`).                                                               |
   | `minWidth`, `minHeight` | Optional. Smallest portrait viewport (CSS px) the game fits. Default 360×600. See [Play page sizing](#play-page-sizing). |
   | `minWidthLandscape`, `minHeightLandscape` | Optional. Same for landscape. Default 640×360.                                   |

2. **Add a thumbnail** at `public/thumbs/<id>.png`, 1280×720 (16:9). To capture a real screenshot of the live game with Playwright:

   ```sh
   npx playwright install chromium   # first time only
   node scripts/thumb.mjs https://my-game.vercel.app public/thumbs/my-game.png
   ```

   The script loads the page at 1280×720, waits ~8 seconds for the game to render, then saves the PNG. With no arguments it re-captures Super Star Party.

3. **If the game is NOT hosted on `*.vercel.app`**, add its origin to `frame-src` in the `Content-Security-Policy` header in [`vercel.json`](vercel.json). Otherwise the play page's iframe will be blocked:

   ```
   frame-src https://super-star-party.vercel.app https://*.vercel.app https://my-game.example.com;
   ```

   The game's own site must also allow being framed (no `X-Frame-Options: DENY` or restrictive `frame-ancestors`). If it doesn't, the card's main Play button still works, because it opens the game in a new tab.

4. Run `npm run build`, then commit and push.

## Play page sizing

The play page sizes the game frame to the area you can actually see. It tracks `visualViewport`, so the frame follows Safari's toolbars showing and hiding, rotation and full screen. The frame is inset by the device's safe areas (notch, home indicator), because iOS reports zero insets inside an iframe. Without JS, the CSS falls back to `100vh` / `-webkit-fill-available` / `100dvh`.

- **Minimum size.** Each game has a minimum logical size: 360×600 in portrait and 640×360 in landscape, unless `games.json` overrides it with `minWidth`/`minHeight` or `minWidthLandscape`/`minHeightLandscape` (numbers from 200 to 4000; anything else is ignored). If the usable area is smaller in either direction, the iframe is rendered larger and scaled down with `transform: scale(s)`, where `s = min(usableW / minW, usableH / minH)`. The logical size keeps the screen's aspect ratio, so the scaled game still fills the screen, and it never gets less than its minimum. Browsers map taps and clicks into a scaled iframe natively.
- **Caveat:** a scaled game renders everything smaller, including text and tap targets. Keep minimums as small as the game's layout allows. Super Star Party sets `minHeightLandscape: 500` because its title menu clips below about 500px tall, so on a landscape phone it plays at about 0.75×.
- **Large screens are full-bleed.** At or above the minimum the frame is 1:1, and it is never scaled up. Tablets and desktops just give the game the whole screen, and the game handles its own large layout.
- **Controls.** In portrait the pill sits at the top center. In landscape it moves to the left edge as a vertical pill, clear of the notch, so it doesn't cover the game's heading. Each button is at least 44×44 px to tap, even though the drawn pill is smaller.
- **CSS hooks.** `play.ts` sets `--vw`, `--vh`, `--usable-w`, `--usable-h` and `--vmin` on `<html>`, plus the classes `is-portrait`/`is-landscape` and `size-compact` (usable short side < 500px), `size-regular` (< 900px) or `size-wide`. `#stage[data-scale]` holds the current scale.

To check it, run `node tools/probe-play.mjs` against a preview build (`npm run build && npx vite preview --port 5291 --strictPort`). It loads the play page in WebKit and Chromium at ten phone, tablet and desktop sizes, and checks frame fit, overflow, tap targets, HUD placement, the feedback dialog and input mapping. It writes `shots/responsive/report.json`, screenshots and a contact sheet, and exits 1 on any failure. Use `--url=`, `--sizes=375x635,844x390` or `--browsers=webkit` to point it elsewhere or narrow it down. Playwright can't simulate safe-area insets or Safari's real toolbars, so test on a real phone too.

## Deploy

The site is hosted on Vercel and auto-deploys from git:

- **Push to `main`** → Vercel runs `npm run build` and deploys `dist/` to production.
- Pushes to other branches and PRs get preview deployments.

[`vercel.json`](vercel.json) sets the framework (Vite) and applies security headers to every route:

- a strict Content-Security-Policy: scripts, styles, and images come from the site itself only, iframes only from allowed game origins, and the site itself can't be framed
- `X-Content-Type-Options`
- `Referrer-Policy`
- `X-Frame-Options: DENY`
- a minimal `Permissions-Policy`
- HSTS
