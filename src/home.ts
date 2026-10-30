import './account-pill';
import { trackEvent } from './analytics';
import { attachFeedback } from './feedback';
import { el, loadGames, statusClass, type Game } from './games';
import { DAILY_GAME, dailyFor, goalText, standing } from './shared/daily.mjs';
import { readCopy } from './shared/device-copy.mjs';

const grid = document.getElementById('grid') as HTMLUListElement;
const count = document.getElementById('count') as HTMLParagraphElement;

attachFeedback(document.getElementById('feedback') as HTMLButtonElement);

/** The thumbnail, with a WebP source when there is one. Same markup as thumbHtml() in scripts/seo.mjs. */
function thumbImg(game: Game, index: number): HTMLElement {
  const img = el('img', {
    src: game.thumbnail,
    alt: `${game.name} screenshot`,
    width: '1280',
    height: '720',
    decoding: 'async',
    loading: index < 2 ? 'eager' : 'lazy',
  });
  return game.thumbnailWebp ? el('picture', {}, el('source', { type: 'image/webp', srcset: game.thumbnailWebp }), img) : img;
}

function card(game: Game, index: number): HTMLLIElement {
  const img = thumbImg(game, index);

  // Hosted games play at /play.html. External games open their own site in a new tab (same as scripts/seo.mjs).
  const playLink = game.external
    ? { href: game.playUrl, target: '_blank', rel: 'noopener noreferrer' }
    : { href: `/play.html?id=${encodeURIComponent(game.id)}` };
  const cover = el(
    'a',
    { class: 'card-cover', ...playLink, 'aria-label': game.external ? `Play ${game.name} (opens in a new tab)` : `Play ${game.name} here` },
    img,
    el('span', { class: statusClass(game.status) }, game.status),
  );

  // One Play button. The play page's own controls can still open a hosted game in a new tab.
  const actions = el('div', { class: 'card-actions' }, el('a', { class: 'btn btn-primary btn-play', ...playLink }, 'Play now'));
  if (game.repo) {
    actions.append(el('a', { class: 'btn btn-link', href: game.repo, target: '_blank', rel: 'noopener' }, 'Source'));
  }
  const players = playersText(game);
  const facts = players ? el('ul', { class: 'card-facts' }, el('li', {}, players)) : null;

  const head = el('div', { class: 'card-head' }, el('h3', { class: 'card-title' }, el('a', { href: `/games/${encodeURIComponent(game.id)}/` }, game.name)));
  const how = game.howItWasMade ? el('div', { class: 'card-how', id: `how-${game.id}`, hidden: '' }, el('p', {}, game.howItWasMade)) : null;
  if (game.howItWasMade) {
    head.append(
      el(
        'button',
        { class: 'card-info', type: 'button', 'aria-expanded': 'false', 'aria-controls': `how-${game.id}`, 'aria-label': `How ${game.name} was made` },
        el('span', { 'aria-hidden': 'true' }, 'i'),
      ),
    );
  }

  return el(
    'li',
    { class: 'card', 'data-game': game.id },
    cover,
    el('div', { class: 'card-body' }, head, el('p', { class: 'card-desc' }, game.description), ...(facts ? [facts] : []), ...(how ? [how] : []), actions),
  );
}

/** Same markup as COMING_SOON_HTML in scripts/seo.mjs. */
function comingSoonCard(): HTMLLIElement {
  return el('li', { class: 'card card-soon' }, el('p', { class: 'card-soon-text' }, 'More games soon'));
}

/** Players shown on the card, e.g. "1–4 players". Matches playersText() in scripts/seo.mjs. */
function playersText(game: Game): string {
  const { minPlayers: min, maxPlayers: max } = game;
  if (!max) return '';
  if (!min || min === max) return `${max} ${max === 1 ? 'player' : 'players'}`;
  return `${min}–${max} players`;
}

// Info button: show or hide the card's "How it was made" panel.
grid.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('.card-info');
  if (!button) return;
  const open = button.getAttribute('aria-expanded') !== 'true';
  button.setAttribute('aria-expanded', String(open));
  const panel = document.getElementById(button.getAttribute('aria-controls') ?? '');
  if (panel) panel.hidden = !open;
});

// game_card_clicked for any link on a game card, prerendered or client-rendered. position is the card's 0-based index.
grid.addEventListener('click', (event) => {
  const card = (event.target as Element).closest('a')?.closest<HTMLLIElement>('li.card[data-game]');
  if (!card) return;
  trackEvent('game_card_clicked', { game_id: card.dataset.game!, position: [...grid.children].indexOf(card) });
});

/**
 * The "Today" card: Flag Catch's challenge for the visitor's date, and, from this device's own copy of the game's
 * save, whether they've cleared it and how long their streak is.
 */
function renderToday(game: Game | undefined): void {
  const box = document.getElementById('today');
  if (!box || !game) return;
  const today = dailyFor(new Date());
  const storage = (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })();
  const { done, streak } = standing(readCopy(storage, DAILY_GAME), today.key);
  const note = done
    ? `Done today${streak > 1 ? ` · ${streak} days in a row` : ''}. Come back tomorrow for a new one.`
    : streak > 0
      ? `Keep your ${streak} day streak going.`
      : 'A new challenge every day. Clear it for bonus points and start a streak.';
  const play = el('a', { class: 'btn btn-primary', href: `/play.html?id=${encodeURIComponent(DAILY_GAME)}&daily=1` }, done ? 'Play it again' : "Play today's challenge");
  play.addEventListener('click', () => trackEvent('daily_card_clicked', { game_id: DAILY_GAME, done, streak }));
  box.replaceChildren(
    el(
      'div',
      { class: `today-card${done ? ' is-done' : ''}` },
      el('p', { class: 'today-kicker' }, `Today's Flag · ${game.name}`),
      el('h2', { class: 'today-goal', id: 'today-title' }, goalText(today)),
      el('p', { class: 'today-where muted' }, `${today.worldName} · ${today.animalName} · ${today.mode === 'playful' ? 'Playful' : 'Capture'}`),
      el('p', { class: 'today-note' }, note),
      play,
    ),
  );
  box.hidden = false;
}

try {
  const games = await loadGames();
  renderToday(games.find((g) => g.id === DAILY_GAME && !g.external));
  grid.replaceChildren(...games.map(card), comingSoonCard());
  count.textContent = `${games.length} ${games.length === 1 ? 'game' : 'games'} ready to play`;
  if (games.length === 0) grid.append(el('li', { class: 'empty' }, 'No games yet. Check back soon!'));
} catch (err) {
  console.error(err);
  grid.replaceChildren(el('li', { class: 'empty' }, 'Could not load the game list. Please refresh.'));
} finally {
  grid.removeAttribute('aria-busy');
}
