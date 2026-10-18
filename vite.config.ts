import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { countText, gridHtml, homeJsonLd, loadGames, sitemapXml, writeGamePages } from './scripts/seo.mjs';

const GAMES_JSON = resolve(import.meta.dirname, 'public/games.json');

/**
 * SEO from public/games.json: prerendered home grid + JSON-LD, generated /games/<id>/ pages
 * (written to games/, gitignored) and dist/sitemap.xml. Adding a game to games.json updates all of it.
 */
function seo(): Plugin {
  return {
    name: 'trueaigaming-seo',
    transformIndexHtml: {
      handler(html, ctx) {
        if (ctx.path !== '/index.html') return;
        const games = loadGames();
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
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(loadGames()) });
    },
    configureServer(server) {
      // Keep generated game pages in sync while `npm run dev` is running.
      server.watcher.add(GAMES_JSON);
      server.watcher.on('change', (file) => {
        if (file === GAMES_JSON) writeGamePages();
      });
      server.middlewares.use('/sitemap.xml', (_req, res) => {
        res.setHeader('Content-Type', 'application/xml');
        res.end(sitemapXml(loadGames()));
      });
    },
  };
}

export default defineConfig({
  plugins: [seo()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        play: resolve(import.meta.dirname, 'play.html'),
        ...writeGamePages(),
      },
    },
  },
});
