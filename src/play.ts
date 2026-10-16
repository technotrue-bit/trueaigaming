import { el, loadGames } from './games';

const title = document.getElementById('title') as HTMLHeadingElement;
const open = document.getElementById('open') as HTMLAnchorElement;
const openAlt = document.getElementById('open-alt') as HTMLAnchorElement;
const fallback = document.getElementById('fallback') as HTMLParagraphElement;
const frameWrap = document.getElementById('frame-wrap') as HTMLDivElement;

function showMessage(heading: string, message: string): void {
  title.textContent = heading;
  frameWrap.replaceChildren(el('div', { class: 'stage-msg' }, el('p', {}, message), el('a', { class: 'btn btn-primary', href: '/' }, 'Back to the arcade')));
}

const id = new URLSearchParams(location.search).get('id');

try {
  const game = (await loadGames()).find((g) => g.id === id);
  if (!game) {
    showMessage('Game not found', "We couldn't find that game. It may have moved.");
  } else {
    document.title = `${game.name}: TrueAIGaming`;
    title.textContent = game.name;
    open.href = openAlt.href = game.playUrl;
    open.hidden = fallback.hidden = false;
    frameWrap.replaceChildren(
      el('iframe', {
        class: 'game-frame',
        src: game.playUrl,
        title: game.name,
        allow: 'fullscreen; autoplay; gamepad; clipboard-write',
        allowfullscreen: '',
        referrerpolicy: 'strict-origin-when-cross-origin',
      }),
    );
  }
} catch (err) {
  console.error(err);
  showMessage('Something broke', 'Could not load the game list. Please refresh.');
}
