# TrueAIGaming

A free, public arcade of games built with AI. Every game listed here was made with AI tools and is free to play in the browser.

It's a static site: Vite + vanilla TypeScript, no backend, no accounts, no trackers, no third-party fonts or CDNs. One file, [`public/games.json`](public/games.json), drives the whole thing.

- **Home (`/`)**: a grid of game cards. Each card links straight to the game's live URL (new tab).
- **Play page (`/play.html?id=<game-id>`)**: embeds the game in an iframe, with a prominent "Open full screen in new tab" link for when embedding doesn't work well (mobile, fullscreen, games that block framing).

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
