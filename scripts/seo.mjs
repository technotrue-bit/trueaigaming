// @ts-check
// Build-time SEO helpers: validated games.json, prerendered home cards, one static page per game,
// JSON-LD, sitemap.xml and llms.txt. Used by vite.config.ts; nothing here ships to the browser.
import { readFileSync, writeFileSync, mkdirSync, rmSync, openSync, readSync, closeSync, existsSync } from 'node:fs';
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
 * @property {string} [thumbnailWebp] Smaller WebP copy of a local PNG thumbnail, when public/ has one next to it.
 * @property {{ width: number, height: number }} thumbSize
 * @property {string} status
 * @property {string} [repo]
 * @property {string} [seoTitle]
 * @property {string} [longDescription]
 * @property {string} [howItWasMade]
 * @property {string} [about]
 * @property {number} [minPlayers]
 * @property {number} [maxPlayers]
 * @property {number} [minWidth] Play-page minimum size (CSS px), 200 to 4000, same as src/games.ts. Used when the game is framed.
 * @property {number} [minHeight]
 * @property {number} [minWidthLandscape]
 * @property {number} [minHeightLandscape]
 * @property {string} author
 * @property {boolean} [external] Submitted game hosted elsewhere: Play goes to playUrl in a new tab, never /play.html.
 * @property {boolean} [cloudSave] The game keeps its save in a signed-in player's account. Same rule as src/games.ts.
 * @property {boolean} [moveCode] The play page passes a #move= link on to the game. Same rule as src/games.ts.
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

/** Min-size hints must be sane CSS pixel sizes; anything else is ignored so the play page defaults apply. Same rule as src/games.ts. @param {unknown} value */
const minSize = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 200 && value <= 4000 ? Math.round(value) : undefined);

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

/** The WebP next to a local PNG thumbnail (/thumbs/x.png -> /thumbs/x.webp), if that file exists. @param {string} path */
function webpSibling(path) {
  if (!path.startsWith('/') || !path.toLowerCase().endsWith('.png')) return undefined;
  const webp = `${path.slice(0, -4)}.webp`;
  return existsSync(join(ROOT, 'public', webp)) ? webp : undefined;
}

/**
 * The thumbnail <img>, wrapped in a <picture> with a WebP source when there is one. Browsers without WebP, and
 * social cards, still get the PNG. Same markup as thumbImg() in src/home.ts.
 * @param {Game} g @param {string} imgAttrs everything on the <img> after src
 */
export function thumbHtml(g, imgAttrs) {
  const img = `<img src="${esc(g.thumbnail)}" ${imgAttrs} />`;
  return g.thumbnailWebp ? `<picture><source type="image/webp" srcset="${esc(g.thumbnailWebp)}" />${img}</picture>` : img;
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
      thumbnailWebp: webpSibling(thumbnail),
      status: isNonEmptyString(r.status) ? r.status.toLowerCase() : 'live',
      repo: safeHttpsUrl(r.repo) ?? undefined,
      seoTitle: isNonEmptyString(r.seoTitle) ? r.seoTitle.trim() : undefined,
      longDescription: isNonEmptyString(r.longDescription) ? r.longDescription.trim() : undefined,
      howItWasMade: isNonEmptyString(r.howItWasMade) ? r.howItWasMade.trim() : undefined,
      about: isNonEmptyString(r.about) ? r.about.trim() : undefined,
      minPlayers,
      maxPlayers: maxPlayers && minPlayers && maxPlayers < minPlayers ? minPlayers : maxPlayers,
      author: isNonEmptyString(r.author) ? r.author.trim() : DEFAULT_AUTHOR,
      external: r.external === true ? true : undefined,
      minWidth: minSize(r.minWidth),
      minHeight: minSize(r.minHeight),
      minWidthLandscape: minSize(r.minWidthLandscape),
      minHeightLandscape: minSize(r.minHeightLandscape),
      // dist/games.json is this list, so a flag left out here never reaches the play page.
      cloudSave: r.cloudSave === true && r.external !== true ? true : undefined,
      moveCode: r.moveCode === true && r.external !== true ? true : undefined,
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

/** GA4 (TrueAIGaming, G-CK2EZQ8PQE). Same snippet as the <head> of index.html and play.html. */
export const GTAG_HTML = `<!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-CK2EZQ8PQE"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-CK2EZQ8PQE');
    </script>`;

// ---------- Home page ----------

/** Where Play goes: /play.html for hosted games, the game's own site in a new tab for external ones. @param {Game} g */
const playAttrs = (g) => (g.external ? `href="${esc(g.playUrl)}" target="_blank" rel="noopener noreferrer"` : `href="${esc(playPath(g))}"`);

/** Cover link label. An external cover says it opens a new tab. Same text as home.ts card(). @param {Game} g */
const coverLabel = (g) => `Play ${esc(g.name)}${g.external ? ' (opens in a new tab)' : ''}`;

/** Same markup and classes as card() in src/home.ts. @param {Game} g @param {number} index */
export function cardHtml(g, index) {
  // One Play button. The play page's own controls can still open a hosted game in a new tab.
  const actions = [`<a class="btn btn-primary btn-play" ${playAttrs(g)}>Play now</a>`];
  const players = playersText(g);
  const facts = players ? `<ul class="card-facts"><li>${esc(players)}</li></ul>` : '';
  if (g.repo) actions.push(`<a class="btn btn-link" href="${esc(g.repo)}" target="_blank" rel="noopener">Source</a>`);
  const id = esc(g.id);
  const info = g.howItWasMade
    ? `<button class="card-info" type="button" aria-expanded="false" aria-controls="how-${id}" aria-label="How ${esc(g.name)} was made"><span aria-hidden="true">i</span></button>`
    : '';
  const how = g.howItWasMade ? `<div class="card-how" id="how-${id}" hidden><p>${esc(g.howItWasMade)}</p></div>` : '';
  return `<li class="card" data-game="${id}">
          <a class="card-cover" ${playAttrs(g)} aria-label="${coverLabel(g)}">
            ${thumbHtml(g, `alt="${esc(g.name)} screenshot" width="1280" height="720" decoding="async" loading="${index < 2 ? 'eager' : 'lazy'}"`)}<span class="${statusClass(g.status)}">${esc(g.status)}</span>
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

/** Readable text below the game card, so search engines get more than a one-liner. @param {Game} g */
export function aboutHtml(g) {
  const sections = [];
  if (g.about) sections.push(`<h2>About ${esc(g.name)}</h2>\n        <p>${esc(g.about)}</p>`);
  if (g.howItWasMade) sections.push(`<h2>How it was made</h2>\n        <p>${esc(g.howItWasMade)}</p>`);
  return sections.length ? `\n      <section class="gp-about">\n        ${sections.join('\n        ')}\n      </section>` : '';
}

/** @param {Game} g */
export function gamePageHtml(g) {
  const players = playersText(g);
  const longDesc = g.longDescription && g.longDescription !== g.description ? `\n          <p class="gp-long">${esc(g.longDescription)}</p>` : '';
  const source = g.repo ? `\n            <a class="btn btn-link" href="${esc(g.repo)}" target="_blank" rel="noopener">Source</a>` : '';
  const playButtons = g.external
    ? `<a class="btn btn-primary btn-lg" ${playAttrs(g)}>Play now</a>`
    : `<a class="btn btn-primary btn-lg" ${playAttrs(g)}>Play now</a>
            <a class="btn btn-link" href="${esc(g.playUrl)}" target="_blank" rel="noopener">Open in a new tab ↗</a>`;
  return `<!doctype html>
<!-- Generated by scripts/seo.mjs from public/games.json. Do not edit; changes are overwritten on every dev/build. -->
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${GTAG_HTML}
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
          ${thumbHtml(g, `alt="${esc(g.name)} screenshot" width="${g.thumbSize.width}" height="${g.thumbSize.height}" decoding="async" fetchpriority="high"`)}<span class="${statusClass(g.status)}">${esc(g.status)}</span>
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
          <p class="gp-tip">Enjoying it? Tips keep the games free. <a class="btn btn-tip" href="${KOFI_URL}" target="_blank" rel="noopener">Support on Ko-fi</a></p>
        </div>
      </article>${aboutHtml(g)}
    </main>
    <footer class="footer wrap">
      <p>Free to play. No account needed.</p>
      <p><a href="/account">Sign in or share your game</a> &middot; <a href="/privacy.html">Privacy</a> &middot; <a href="/terms.html">Terms</a></p>
      <p class="tip">Tips keep the games free. <a class="btn btn-tip" href="${KOFI_URL}" target="_blank" rel="noopener">Support on Ko-fi</a></p>
      <p class="tip"><a class="btn btn-tip" href="${X_URL}" target="_blank" rel="noopener">Follow @ItsMeTrueG on X</a></p>
      <p class="legal">&copy; 2026 TrueAIGaming. All rights reserved.</p>
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

// ---------- llms.txt / llms-full.txt ----------
// Plain-text guides for AI assistants and agents (https://llmstxt.org): what the site is, where each game lives and
// where the machine-readable list is. Built from the same list as the sitemap, so a new game shows up in all of them.

const SITE_SUMMARY = 'A free arcade of games built with AI. Every game plays instantly in a web browser on a phone or computer, with nothing to install and no account needed.';

/** One line of markdown-safe text: no line breaks, and square brackets can't end a link label. @param {string} s */
const mdLine = (s) => s.replace(/\s+/g, ' ').replace(/\[/g, '(').replace(/\]/g, ')').trim();

/** "A demo game" -> "A demo game." @param {string} s */
const sentence = (s) => {
  const t = mdLine(s);
  return t && !/[.!?]$/.test(t) ? `${t}.` : t;
};

/** @param {Game} g */
function llmsGameLine(g) {
  const desc = sentence(g.description);
  const players = playersText(g);
  const facts = [players, g.status === 'live' ? '' : `status: ${g.status}`].filter(Boolean).join(', ');
  return `- [${mdLine(g.name)}](${abs(gamePath(g))}): ${desc}${facts ? ` (${facts})` : ''} Play: ${g.playUrl}`;
}

const LLMS_PAGES = `## About the site

- [Privacy](${ORIGIN}/privacy.html): what the site stores, and how to delete it
- [Terms](${ORIGIN}/terms.html): the rules for playing and for sharing your own game
- [Share your game](${ORIGIN}/account): signed-in players (13 and up) can submit a game made with AI; it appears after review
- [Support on Ko-fi](${KOFI_URL}): tips keep the games free
- [${SITE_NAME} on X](${X_URL}): news and new games`;

/** @param {Game[]} games */
export function llmsTxt(games) {
  return `# ${SITE_NAME}

> ${SITE_SUMMARY}

Each game has its own page on ${SITE_NAME} with a description and a Play button; the "Play" link goes straight to the game. Games are free. Accounts are optional and only used to share your own game or keep progress in some games across devices.

## Games

${games.map(llmsGameLine).join('\n')}

## Machine-readable

- [Games list (JSON)](${ORIGIN}/games.json): every game with id, name, description, playUrl, status and thumbnail
- [Full guide](${ORIGIN}/llms-full.txt): this file plus each game's full description and how it was made
- [Sitemap](${ORIGIN}/sitemap.xml)

${LLMS_PAGES}
`;
}

/** @param {Game[]} games */
export function llmsFullTxt(games) {
  const sections = games.map((g) => {
    const players = playersText(g);
    const lines = [
      `## ${mdLine(g.name)}`,
      '',
      sentence(g.longDescription ?? gameDescription(g)),
      '',
      `- Page: ${abs(gamePath(g))}`,
      `- Play: ${g.playUrl}`,
      players ? `- For ${players}` : '',
      `- Status: ${g.status}`,
      `- Made by: ${mdLine(g.author)}`,
      g.repo ? `- Source: ${g.repo}` : '',
    ].filter((l, i, all) => l !== '' || all[i - 1] !== '');
    if (g.about) lines.push('', sentence(g.about));
    if (g.howItWasMade) lines.push('', `How it was made: ${sentence(g.howItWasMade)}`);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n');
  });
  return `# ${SITE_NAME}

> ${SITE_SUMMARY}

${sections.join('\n\n')}

${LLMS_PAGES}
`;
}
