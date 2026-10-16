import { attachFeedback } from './feedback';
import { el, loadGames } from './games';

/** Safari (incl. older iPadOS) only ships the prefixed Fullscreen API. */
interface WebkitDocument extends Document {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
}
interface WebkitElement extends HTMLElement {
  webkitRequestFullscreen?: () => void;
}

const doc = document as WebkitDocument;
const stage = document.getElementById('stage') as WebkitElement;
const title = document.getElementById('title') as HTMLHeadingElement;
const hud = document.getElementById('hud') as HTMLElement;
const fullscreenBtn = document.getElementById('fullscreen') as HTMLButtonElement;
const newTab = document.getElementById('new-tab') as HTMLAnchorElement;
const frameWrap = document.getElementById('frame-wrap') as HTMLDivElement;

/* ---------- Fullscreen (hidden where unsupported, e.g. iPhone) ---------- */
const canFullscreen = Boolean(doc.fullscreenEnabled || (doc.webkitFullscreenEnabled && stage.webkitRequestFullscreen));

function isFullscreen(): boolean {
  return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (doc.fullscreenElement) await doc.exitFullscreen();
    else if (doc.webkitFullscreenElement) doc.webkitExitFullscreen?.();
    else if (doc.fullscreenEnabled) await stage.requestFullscreen({ navigationUI: 'hide' });
    else stage.webkitRequestFullscreen?.();
  } catch (err) {
    console.warn('Fullscreen request failed', err);
  }
  // Hand keyboard focus back to the game rather than leaving it on the button.
  stage.querySelector('iframe')?.focus();
}

function syncFullscreen(): void {
  const active = isFullscreen();
  fullscreenBtn.classList.toggle('is-active', active);
  fullscreenBtn.setAttribute('aria-label', active ? 'Exit full screen' : 'Full screen');
}

fullscreenBtn.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', syncFullscreen);
document.addEventListener('webkitfullscreenchange', syncFullscreen);

/* ---------- Fade the overlay after a few seconds without pointer activity ---------- */
const IDLE_MS = 3000;
let idleTimer: number | undefined;

function wake(): void {
  hud.classList.remove('is-idle');
  clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => hud.classList.add('is-idle'), IDLE_MS);
}

document.addEventListener('pointermove', wake, { passive: true });
document.addEventListener('pointerdown', wake, { passive: true });
wake();

/* ---------- Feedback (dialog lives inside the stage so it still shows in full screen) ---------- */
let currentGameId: string | undefined;
attachFeedback(document.getElementById('feedback') as HTMLButtonElement, { mount: stage, currentGame: () => currentGameId });

/* ---------- Load the game ---------- */
function showMessage(heading: string, message: string): void {
  title.textContent = heading;
  title.classList.remove('visually-hidden');
  frameWrap.replaceChildren(el('div', { class: 'stage-msg' }, title, el('p', {}, message), el('a', { class: 'btn btn-primary', href: '/' }, 'Back to the arcade')));
}

const id = new URLSearchParams(location.search).get('id');

try {
  const game = (await loadGames()).find((g) => g.id === id);
  if (!game) {
    showMessage('Game not found', "We couldn't find that game. It may have moved.");
  } else {
    document.title = `${game.name}: TrueAIGaming`;
    title.textContent = game.name;
    currentGameId = game.id;
    newTab.href = game.playUrl;
    newTab.hidden = false;
    fullscreenBtn.hidden = !canFullscreen;
    frameWrap.replaceChildren(
      el('iframe', {
        class: 'game-frame',
        src: game.playUrl,
        title: game.name,
        allow: 'fullscreen; autoplay; gamepad; clipboard-write; accelerometer; gyroscope; screen-wake-lock; web-share; xr-spatial-tracking',
        allowfullscreen: '',
        referrerpolicy: 'strict-origin-when-cross-origin',
      }),
    );
  }
} catch (err) {
  console.error(err);
  showMessage('Something broke', 'Could not load the game list. Please refresh.');
}
