import './analytics';
import { attachFeedback } from './feedback';
import { el, loadGames, statusClass, type Game } from './games';

const grid = document.getElementById('grid') as HTMLUListElement;
const count = document.getElementById('count') as HTMLParagraphElement;

attachFeedback(document.getElementById('feedback') as HTMLButtonElement);

function card(game: Game, index: number): HTMLLIElement {
  const img = el('img', {
    src: game.thumbnail,
    alt: `${game.name} screenshot`,
    width: '1280',
    height: '720',
    decoding: 'async',
    loading: index < 2 ? 'eager' : 'lazy',
  });

  const cover = el(
    'a',
    { class: 'card-cover', href: game.playUrl, target: '_blank', rel: 'noopener', 'aria-label': `Play ${game.name} (opens in new tab)` },
    img,
    el('span', { class: statusClass(game.status) }, game.status),
  );

  const actions = el(
    'div',
    { class: 'card-actions' },
    el('a', { class: 'btn btn-primary', href: game.playUrl, target: '_blank', rel: 'noopener' }, 'Play ↗'),
    el('a', { class: 'btn btn-ghost', href: `/play.html?id=${encodeURIComponent(game.id)}` }, 'Play here'),
  );
  if (game.repo) {
    actions.append(el('a', { class: 'btn btn-link', href: game.repo, target: '_blank', rel: 'noopener' }, 'Source'));
  }

  return el(
    'li',
    { class: 'card' },
    cover,
    el('div', { class: 'card-body' }, el('h3', { class: 'card-title' }, el('a', { href: `/games/${encodeURIComponent(game.id)}/` }, game.name)), el('p', { class: 'card-desc' }, game.description), actions),
  );
}

try {
  const games = await loadGames();
  grid.replaceChildren(...games.map(card));
  count.textContent = `${games.length} ${games.length === 1 ? 'game' : 'games'} ready to play`;
  if (games.length === 0) grid.append(el('li', { class: 'empty' }, 'No games yet. Check back soon!'));
} catch (err) {
  console.error(err);
  grid.replaceChildren(el('li', { class: 'empty' }, 'Could not load the game list. Please refresh.'));
} finally {
  grid.removeAttribute('aria-busy');
}
