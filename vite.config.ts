import { defineConfig, type Plugin } from 'vite';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { countText, gridHtml, homeJsonLd, loadGames, sitemapXml, writeGamePages, type Game } from './scripts/seo.mjs';
import { loadPublishedGames } from './scripts/published-games.mjs';

const GAMES_JSON = resolve(import.meta.dirname, 'public/games.json');
const DIST_GAMES_JSON = resolve(import.meta.dirname, 'dist/games.json');

/**
 * The list every consumer uses: first-party games from public/games.json, then approved submissions. This is the only
 * place that reads the environment. A collision, a bad row or a missing Supabase setting throws, so no partial list is
 * ever built.
 */
async function combinedGames(): Promise<Game[]> {
  const games = loadGames();
  const published = await loadPublishedGames({ env: process.env, existingIds: games.map((g) => g.id) });
  return [...games, ...published];
}

/**
 * SEO from the combined list: prerendered home grid + JSON-LD, generated /games/<id>/ pages (written to games/,
 * gitignored), dist/sitemap.xml and dist/games.json. Dev serves the same list at /games.json. Adding a game to
 * games.json, or approving a submission, updates all of it.
 */
function seo(initial: Game[]): Plugin {
  let games = initial;
  return {
    name: 'trueaigaming-seo',
    transformIndexHtml: {
      handler(html, ctx) {
        if (ctx.path !== '/index.html') return;
        // Function replacements so "$&" etc. in game names are inserted literally.
        const out = html
          .replace('<p id="count" class="muted" aria-live="polite"></p>', () => `<p id="count" class="muted" aria-live="polite">${countText(games.length)}</p>`)
          .replace('<ul id="grid" class="grid" aria-busy="true"></ul>', () => `<ul id="grid" class="grid">\n        ${gridHtml(games)}\n      </ul>`)
          .replace('</head>', () => `  ${homeJsonLd(games)}\n  </head>`);
        if (!out.includes('<ul id="grid" class="grid">')) throw new Error('seo: #grid placeholder not found in index.html');
        return out;
      },
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(games) });
    },
    closeBundle() {
      // Runs after Vite has copied public/ into dist/, so this replaces the copy of public/games.json. The browser fetches
      // /games.json at run time (src/games.ts), so it must see the same list as the prerender.
      writeFileSync(DIST_GAMES_JSON, `${JSON.stringify(games, null, 2)}\n`);
    },
    configureServer(server) {
      // Keep the list and the generated game pages in sync while `npm run dev` runs. A failed reload is logged, and the
      // last complete list stays in use.
      const reload = async () => {
        try {
          const next = await combinedGames();
          writeGamePages(next);
          games = next;
        } catch (err) {
          server.config.logger.error(`[seo] games not reloaded, still serving the previous list: ${err instanceof Error ? err.message : String(err)}`);
        }
      };
      server.watcher.add(GAMES_JSON);
      server.watcher.on('change', (file) => {
        if (file === GAMES_JSON) void reload();
      });
      server.middlewares.use('/games.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(games, null, 2));
      });
      server.middlewares.use('/sitemap.xml', (_req, res) => {
        res.setHeader('Content-Type', 'application/xml');
        res.end(sitemapXml(games));
      });
    },
  };
}

export default defineConfig(async () => {
  const games = await combinedGames();
  return {
    plugins: [seo(games)],
    build: {
      rollupOptions: {
        input: {
          main: resolve(import.meta.dirname, 'index.html'),
          play: resolve(import.meta.dirname, 'play.html'),
          account: resolve(import.meta.dirname, 'account.html'),
          submit: resolve(import.meta.dirname, 'submit.html'),
          submissions: resolve(import.meta.dirname, 'submissions.html'),
          admin: resolve(import.meta.dirname, 'admin.html'),
          ...writeGamePages(games),
        },
      },
    },
  };
});
