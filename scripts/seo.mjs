// @ts-check
// Build-time SEO helpers: validated games.json, prerendered home cards, one static page per game,
// JSON-LD and sitemap.xml. Used by vite.config.ts; nothing here ships to the browser.
import { readFileSync, writeFileSync, mkdirSync, rmSync, openSync, readSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isBlobThumbnailUrl } from '../src/shared/submission-rules.mjs';

export const ORIGIN = 'https://trueaigaming.com';
export const SITE_NAME = 'TrueAIGaming';
export const TWITTER = '@ItsMeTrueG';
const DEFAULT_AUTHOR = 'Devin Norris';
const ID = /^[a-z0-9-]+$/;
const MAX_TITLE = 70;
export const KOFI_URL = 'https://ko-fi.com/X3K0291W5Z';
export const X_URL = 'https://x.com/itsmetrueg';

const ROOT = resolve(import.meta.dirname, '..');
/** Generated per-game HTML entries live here (gitignored); Vite builds them to dist/games/<id>/. */
export const PAGES_DIR = join(ROOT, 'games');

/**
 * @typedef {object} Game
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} playUrl
 * @property {string} thumbnail
 * @property {{ width: number, height: number }} thumbSize
 * @property {string} status
 * @property {string} [repo]
 * @property {string} [seoTitle]
 * @property {string} [longDescription]
 * @property {string} [howItWasMade]
 * @property {number} [minPlayers]
 * @property {number} [maxPlayers]
 * @property {string} author
 * @property {boolean} [external] Submitted game hosted elsewhere: Play goes to playUrl in a new tab, never /play.html.
 */

// ---------- Escaping ----------

/** @param {string} s */
export function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** JSON for a <script type="application/ld+json"> block; "<" etc. can't close the tag. @param {unknown} data */
export function jsonLd(data) {
  const json = JSON.stringify(data, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
  return `<script type="application/ld+json">\n${json}\n</script>`;
}

/** @param {string} path */
export const abs = (path) => new URL(path, ORIGIN).href;
export const gamePath = (/** @type {Game} */ g) => `/games/${g.id}/`;
export const playPath = (/** @type {Game} */ g) => `/play.html?id=${encodeURIComponent(g.id)}`;

// ---------- games.json (same rules as src/games.ts) ----------

/** @param {unknown} value */
function safeHttpsUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** @param {unknown} value */
function safeLocalPath(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : null;
}

/** Same-origin path, or an https Vercel Blob URL without credentials, for submitted games. Same rules as src/games.ts. @param {unknown} value */
function safeThumbnail(value) {
  if (typeof value === 'string' && isBlobThumbnailUrl(value)) {
    const url = new URL(value);
    if (!url.username && !url.password) return url.href;
  }
  return safeLocalPath(value);
}

/** @param {unknown} value @returns {value is string} */
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

/** @param {unknown} value */
const positiveInt = (value) => (Number.isInteger(value) && /** @type {number} */ (value) > 0 ? /** @type {number} */ (value) : undefined);

/** Real pixel size of a local PNG thumbnail (IHDR); other formats and remote thumbnails fall back to the documented 1280x720. @param {string} path */
function imageSize(path) {
  const fallback = { width: 1280, height: 720 };
  if (!path.startsWith('/') || !path.toLowerCase().endsWith('.png')) return fallback;
  try {
    const fd = openSync(join(ROOT, 'public', path), 'r');
    const buf = Buffer.alloc(24);
    readSync(fd, buf, 0, 24, 0);
    closeSync(fd);
    if (buf.toString('ascii', 12, 16) !== 'IHDR') return fallback;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } catch {
    console.warn(`[seo] thumbnail not found: public${path}`);
    return fallback;
  }
}

/** @param {string} [file] games.json to read. Defaults to public/games.json. @returns {Game[]} */
export function loadGames(file = join(ROOT, 'public/games.json')) {
  /** @type {unknown} */
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(data)) throw new Error('public/games.json must be an array');
  /** @type {Game[]} */
  const games = [];
  for (const raw of data) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = /** @type {Record<string, unknown>} */ (raw);
    const playUrl = safeHttpsUrl(r.playUrl);
    const thumbnail = safeThumbnail(r.thumbnail);
    // Skipped exactly like src/games.ts skips them, so the prerendered grid matches the JS one.
    if (!isNonEmptyString(r.id) || !isNonEmptyString(r.name) || !playUrl || !thumbnail) {
      // Never print the raw entry: it can hold a credentialed thumbnail URL.
      console.warn(`[seo] skipping invalid games.json entry: ${JSON.stringify(isNonEmptyString(r.id) ? r.id : isNonEmptyString(r.name) ? r.name : '(unnamed entry)')}`);
      continue;
    }
    // The id becomes a directory and URL; fail loudly rather than publish a broken link.
    if (!ID.test(r.id)) throw new Error(`games.json: id ${JSON.stringify(r.id)} must match ${ID}`);
    if (games.some((g) => g.id === r.id)) throw new Error(`games.json: duplicate id ${JSON.stringify(r.id)}`);
    const minPlayers = positiveInt(r.minPlayers);
    const maxPlayers = positiveInt(r.maxPlayers);
    games.push({
      id: r.id,
      name: r.name,
      description: typeof r.description === 'string' ? r.description : '',
      playUrl,
      thumbnail,
      thumbSize: imageSize(thumbnail),
      status: isNonEmptyString(r.status) ? r.status.toLowerCase() : 'live',
      repo: safeHttpsUrl(r.repo) ?? undefined,
      seoTitle: isNonEmptyString(r.seoTitle) ? r.seoTitle.trim() : undefined,
      longDescription: isNonEmptyString(r.longDescription) ? r.longDescription.trim() : undefined,
      howItWasMade: isNonEmptyString(r.howItWasMade) ? r.howItWasMade.trim() : undefined,
      minPlayers,
      maxPlayers: maxPlayers && minPlayers && maxPlayers < minPlayers ? minPlayers : maxPlayers,
      author: isNonEmptyString(r.author) ? r.author.trim() : DEFAULT_AUTHOR,
      external: r.external === true ? true : undefined,
    });
  }
  return games;
}

/** @param {string} status */
const statusClass = (status) => (/^[a-z-]+$/.test(status) ? `status status-${status}` : 'status');

/** @param {number} n */
export const countText = (n) => `${n} ${n === 1 ? 'game' : 'games'} ready to play`;

// ---------- Copy derived from data ----------

/** "A 4-player game" -> "a 4-player game", but leave acronyms like "AI racer" alone. @param {string} s */
const lowerFirst = (s) => (/^[A-Z](?![A-Z])/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
/** @param {string} s */
const trimDot = (s) => s.trim().replace(/[.!]+$/, '');

/** "<name>: <description>, free to play", shortened until the full title fits in ~70 chars. @param {Game} g */
export function gameTitle(g) {
  const suffix = ` | ${SITE_NAME}`;
  if (g.seoTitle) return g.seoTitle + suffix;
  const desc = lowerFirst(trimDot(g.description));
  const candidates = desc
    ? [`${g.name}: ${desc}, free to play`, `${g.name}: free ${desc.replace(/^(a|an|the) /, '')}`, `${g.name}: ${desc}`]
    : [];
  candidates.push(`${g.name}: play free in your browser`, g.name);
  const fit = candidates.find((c) => (c + suffix).length <= MAX_TITLE) ?? g.name;
  return fit + suffix;
}

/** @param {Game} g */
export function gameDescription(g) {
  if (g.longDescription) return g.longDescription;
  const lead = trimDot(g.description) || g.name;
  return `${lead}. Free to play in your browser on ${SITE_NAME}, built with AI.`;
}

/** @param {Game} g */
function playersText(g) {
  const { minPlayers: min, maxPlayers: max } = g;
  if (!max) return '';
  if (!min || min === max) return `${max} ${max === 1 ? 'player' : 'players'}`;
  return `${min}–${max} players`;
}

// ---------- Shared head ----------

export const ICON_LINKS = `<link rel="icon" href="/favicon.ico" sizes="32x32" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />`;

/**
 * Title, description, canonical, Open Graph and Twitter tags.
 * @param {{ title: string, description: string, path: string, type: string, image: string, imageWidth: number, imageHeight: number, imageAlt: string }} m
 */
export function metaTags(m) {
  const url = abs(m.path);
  const image = abs(m.image);
  return [
    `<title>${esc(m.title)}</title>`,
    `<meta name="description" content="${esc(m.description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="${esc(m.type)}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:title" content="${esc(m.title)}" />`,
    `<meta property="og:description" content="${esc(m.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:image:width" content="${m.imageWidth}" />`,
    `<meta property="og:image:height" content="${m.imageHeight}" />`,
    `<meta property="og:image:alt" content="${esc(m.imageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:site" content="${TWITTER}" />`,
    `<meta name="twitter:title" content="${esc(m.title)}" />`,
    `<meta name="twitter:description" content="${esc(m.description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
    `<meta name="twitter:image:alt" content="${esc(m.imageAlt)}" />`,
  ].join('\n    ');
}

const ORGANIZATION = {
  '@type': 'Organization',
  '@id': `${ORIGIN}/#organization`,
  name: SITE_NAME,
  url: `${ORIGIN}/`,
  logo: { '@type': 'ImageObject', url: abs('/icon-512.png'), width: 512, height: 512 },
  sameAs: ['https://x.com/ItsMeTrueG'],
};

// ---------- Home page ----------

/** Where Play goes: /play.html for hosted games, the game's own site in a new tab for external ones. @param {Game} g */
const playAttrs = (g) => (g.external ? `href="${esc(g.playUrl)}" target="_blank" rel="noopener noreferrer"` : `href="${esc(playPath(g))}"`);

/** Cover link label. An external cover says it opens a new tab. Same text as home.ts card(). @param {Game} g */
const coverLabel = (g) => `Play ${esc(g.name)}${g.external ? ' (opens in a new tab)' : ''}`;

/** Same markup and classes as card() in src/home.ts. @param {Game} g @param {number} index */
export function cardHtml(g, index) {
  const actions = g.external
    ? [`<a class="btn btn-primary" ${playAttrs(g)}>Play</a>`]
    : [
        `<a class="btn btn-primary" ${playAttrs(g)}>Play here</a>`,
        `<a class="btn btn-link" href="${esc(g.playUrl)}" target="_blank" rel="noopener">Play in browser ↗</a>`,
      ];
  const players = playersText(g);
  const facts = players ? `<ul class="card-facts"><li>${esc(players)}</li></ul>` : '';
  if (g.repo) actions.push(`<a class="btn btn-link" href="${esc(g.repo)}" target="_blank" rel="noopener">Source</a>`);
  const id = esc(g.id);
  const info = g.howItWasMade
    ? `<button class="card-info" type="button" aria-expanded="false" aria-controls="how-${id}" aria-label="How ${esc(g.name)} was made"><span aria-hidden="true">i</span></button>`
    : '';
  const how = g.howItWasMade ? `<div class="card-how" id="how-${id}" hidden><p>${esc(g.howItWasMade)}</p></div>` : '';
  return `<li class="card">
          <a class="card-cover" ${playAttrs(g)} aria-label="${coverLabel(g)}">
            <img src="${esc(g.thumbnail)}" alt="${esc(g.name)} screenshot" width="1280" height="720" decoding="async" loading="${index < 2 ? 'eager' : 'lazy'}" /><span class="${statusClass(g.status)}">${esc(g.status)}</span>
          </a>
          <div class="card-body">
            <div class="card-head">
              <h3 class="card-title"><a href="${esc(gamePath(g))}">${esc(g.name)}</a></h3>${info}
            </div>
            <p class="card-desc">${esc(g.description)}</p>
            ${facts}
            ${how}
            <div class="card-actions">${actions.join('')}</div>
          </div>
        </li>`;
}

/** Same markup as comingSoonCard() in src/home.ts. */
const COMING_SOON_HTML = '<li class="card card-soon"><p class="card-soon-text">More games soon</p></li>';

/** @param {Game[]} games */
export function gridHtml(games) {
  const cards = games.length === 0 ? ['<li class="empty">No games yet. Check back soon!</li>'] : games.map(cardHtml);
  return [...cards, COMING_SOON_HTML].join('\n        ');
}

/** @param {Game[]} games */
export function homeJsonLd(games) {
  return jsonLd({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${ORIGIN}/#website`,
        name: SITE_NAME,
        url: `${ORIGIN}/`,
        description: 'A free arcade of games built with AI. Pick one and play instantly in your browser.',
        inLanguage: 'en',
        publisher: { '@id': ORGANIZATION['@id'] },
      },
      ORGANIZATION,
      {
        '@type': 'ItemList',
        name: `${SITE_NAME} games`,
        numberOfItems: games.length,
        itemListElement: games.map((g, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(gamePath(g)), name: g.name })),
      },
    ],
  });
}

// ---------- Game pages ----------

/** @param {Game} g */
function gameJsonLd(g) {
  /** @type {Record<string, unknown>} */
  const game = {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: g.name,
    description: gameDescription(g),
    url: abs(gamePath(g)),
    image: abs(g.thumbnail),
    screenshot: abs(g.thumbnail),
    gamePlatform: 'Web browser',
    applicationCategory: 'Game',
    operatingSystem: 'Any',
    playMode: (g.maxPlayers ?? 1) > 1 ? 'MultiPlayer' : 'SinglePlayer',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock', url: abs(gamePath(g)) },
    author: { '@type': 'Person', name: g.author },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: `${ORIGIN}/` },
  };
  if (g.maxPlayers) game.numberOfPlayers = { '@type': 'QuantitativeValue', minValue: g.minPlayers ?? 1, maxValue: g.maxPlayers };
  if (g.repo) game.sameAs = [g.repo];
  return jsonLd(game);
}

/** @param {Game} g */
export function gamePageHtml(g) {
  const players = playersText(g);
  const longDesc = g.longDescription && g.longDescription !== g.description ? `\n          <p class="gp-long">${esc(g.longDescription)}</p>` : '';
  const source = g.repo ? `\n            <a class="btn btn-link" href="${esc(g.repo)}" target="_blank" rel="noopener">Source</a>` : '';
  const playButtons = g.external
    ? `<a class="btn btn-primary btn-lg" ${playAttrs(g)}>Play</a>`
    : `<a class="btn btn-primary btn-lg" ${playAttrs(g)}>Play here</a>
            <a class="btn btn-ghost" href="${esc(g.playUrl)}" target="_blank" rel="noopener">Play in browser ↗</a>`;
  return `<!doctype html>
<!-- Generated by scripts/seo.mjs from public/games.json. Do not edit; changes are overwritten on every dev/build. -->
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <meta name="theme-color" content="#0b0221" />
    ${metaTags({
      title: gameTitle(g),
      description: gameDescription(g),
      path: gamePath(g),
      type: 'website',
      image: g.thumbnail,
      imageWidth: g.thumbSize.width,
      imageHeight: g.thumbSize.height,
      imageAlt: `${g.name} screenshot`,
    })}
    ${ICON_LINKS}
    ${gameJsonLd(g)}
  </head>
  <body class="game-page" data-game="${esc(g.id)}">
    <a class="skip" href="#game">Skip to game</a>
    <header class="gp-header wrap">
      <a class="gp-brand logo" href="/" aria-label="${SITE_NAME} home"><span class="logo-true">True</span><span class="logo-ai">AI</span><span class="logo-gaming">Gaming</span></a>
    </header>
    <main id="game" class="wrap gp-main">
      <a class="gp-back" href="/">← Back to all games</a>
      <article class="gp-game">
        <a class="gp-shot card-cover" ${playAttrs(g)} aria-label="${coverLabel(g)}">
          <img src="${esc(g.thumbnail)}" alt="${esc(g.name)} screenshot" width="${g.thumbSize.width}" height="${g.thumbSize.height}" decoding="async" fetchpriority="high" /><span class="${statusClass(g.status)}">${esc(g.status)}</span>
        </a>
        <div class="gp-info">
          <h1 class="gp-title">${esc(g.name)}</h1>
          <p class="gp-desc">${esc(g.description)}</p>${longDesc}
          <ul class="gp-facts">
            ${[players, 'Free', 'Runs in your browser'].filter(Boolean).map((f) => `<li>${esc(f)}</li>`).join('')}
          </ul>
          <div class="gp-actions">
            ${playButtons}${source}
          </div>
        </div>
      </article>
    </main>
    <footer class="footer wrap">
      <p>No accounts. Just games.</p>
      <p class="tip">Tips keep the games free. <a class="btn btn-tip" href="${KOFI_URL}" target="_blank" rel="noopener">Support on Ko-fi</a></p>
      <p class="tip"><a class="btn btn-tip" href="${X_URL}" target="_blank" rel="noopener">Follow @ItsMeTrueG on X</a></p>
    </footer>
    <button id="feedback" class="feedback-fab feedback-pill" type="button" aria-label="Feedback: report a bug or add suggestions">Feedback</button>
    <script type="module" src="/src/game-page.ts"></script>
  </body>
</html>
`;
}

/**
 * (Re)write games/<id>/index.html for every game, removing pages for games that are gone.
 * @returns {Record<string, string>} Rollup input map: name -> absolute HTML path.
 */
export function writeGamePages(games = loadGames()) {
  rmSync(PAGES_DIR, { recursive: true, force: true });
  /** @type {Record<string, string>} */
  const inputs = {};
  for (const g of games) {
    const dir = join(PAGES_DIR, g.id);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'index.html');
    writeFileSync(file, gamePageHtml(g));
    inputs[`game-${g.id}`] = file;
  }
  return inputs;
}

// ---------- sitemap.xml ----------

/** @param {Game[]} games */
export function sitemapXml(games) {
  const urls = [`${ORIGIN}/`, ...games.map((g) => abs(gamePath(g)))];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}
</urlset>
`;
}
