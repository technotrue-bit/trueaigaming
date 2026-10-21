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
    { class: 'card-cover', href: `/play.html?id=${encodeURIComponent(game.id)}`, 'aria-label': `Play ${game.name} here` },
    img,
    el('span', { class: statusClass(game.status) }, game.status),
  );

  const actions = el(
    'div',
    { class: 'card-actions' },
    el('a', { class: 'btn btn-primary', href: `/play.html?id=${encodeURIComponent(game.id)}` }, 'Play here'),
    el('a', { class: 'btn btn-ghost', href: game.playUrl, target: '_blank', rel: 'noopener' }, 'Play in browser ↗'),
  );
  if (game.repo) {
    actions.append(el('a', { class: 'btn btn-link', href: game.repo, target: '_blank', rel: 'noopener' }, 'Source'));
  }

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
    { class: 'card' },
    cover,
    el('div', { class: 'card-body' }, head, el('p', { class: 'card-desc' }, game.description), ...(how ? [how] : []), actions),
  );
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
