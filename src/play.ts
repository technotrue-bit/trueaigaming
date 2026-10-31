import { trackEvent, trackShares } from './analytics';
import { attachFeedback } from './feedback';
import { startCloudSaves } from './cloud-saves';
import { el, loadGames, type Game } from './games';

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

/* ---------- Viewport tracking ----------
   Size the stage to the area the user can actually see (visualViewport tracks Safari's bars showing and hiding,
   rotation and full screen), and publish it to CSS on <html>:
     --vw / --vh               visible size in px
     --usable-w / --usable-h   visible size minus safe-area insets and the control pill's strip (what the game frame gets)
     --vmin                    1% of the smaller visible side, for sizing the overlay
   plus is-portrait / is-landscape and a size class from the usable area's shorter side:
     size-compact < 500px (phones)  <=  size-regular < 900px (tablets, laptops)  <=  size-wide.
   Until this runs (or without JS) the CSS falls back to 100vh / -webkit-fill-available / 100dvh. */
const root = document.documentElement;
const SIZE_CLASSES = [
  ['size-compact', 500],
  ['size-regular', 900],
  ['size-wide', Infinity],
] as const;

// env() can't be read from JS directly, so read it back off a hidden element padded by the insets.
const safeProbe = el('div', { class: 'safe-probe', 'aria-hidden': 'true' });
document.body.append(safeProbe);

let visible = { w: 0, h: 0 };
let measureQueued = 0;

function isEditingText(): boolean {
  const a = document.activeElement;
  return a instanceof HTMLTextAreaElement || (a instanceof HTMLInputElement && a.type !== 'radio');
}

function measure(): void {
  measureQueued = 0;
  const vv = window.visualViewport;
  // Undo pinch zoom so zooming in doesn't shrink the stage.
  const w = vv ? vv.width * vv.scale : window.innerWidth;
  const h = vv ? vv.height * vv.scale : window.innerHeight;
  // The on-screen keyboard for the feedback form shrinks the visual viewport; keep the game where it is.
  if (isEditingText() && Math.abs(w - visible.w) < 1 && h < visible.h) return;
  visible = { w, h };

  const cs = getComputedStyle(safeProbe);
  const inset = (side: 'Top' | 'Right' | 'Bottom' | 'Left') => parseFloat(cs[`padding${side}`]) || 0;
  const usableW = Math.max(0, w - inset('Left') - inset('Right'));
  const usableH = Math.max(0, h - inset('Top') - inset('Bottom'));
  const landscape = w > h;
  const shortSide = Math.min(usableW, usableH);
  const sizeClass = SIZE_CLASSES.find(([, below]) => shortSide < below)![0];

  const px = (n: number) => `${Math.round(n * 100) / 100}px`;
  root.style.setProperty('--vw', px(w));
  root.style.setProperty('--vh', px(h));
  root.style.setProperty('--usable-w', px(usableW));
  root.style.setProperty('--usable-h', px(usableH));
  root.style.setProperty('--vmin', px(Math.min(w, h) / 100));
  root.classList.toggle('is-landscape', landscape);
  root.classList.toggle('is-portrait', !landscape);
  for (const [name] of SIZE_CLASSES) root.classList.toggle(name, name === sizeClass);
  root.classList.add('has-vp');
  // The frame's area also leaves out the control pill's strip, so read it back once the classes above are applied.
  const area = frameWrap.getBoundingClientRect();
  if (area.width > 0 && area.height > 0) {
    root.style.setProperty('--usable-w', px(area.width));
    root.style.setProperty('--usable-h', px(area.height));
  }
  fitFrame(landscape);
}

function scheduleMeasure(): void {
  measureQueued ||= requestAnimationFrame(measure);
}

window.visualViewport?.addEventListener('resize', scheduleMeasure);
window.visualViewport?.addEventListener('scroll', scheduleMeasure);
window.addEventListener('resize', scheduleMeasure);
window.addEventListener('orientationchange', () => {
  scheduleMeasure();
  // iOS sometimes reports the pre-rotation size on the first frame after orientationchange.
  setTimeout(scheduleMeasure, 300);
});
document.addEventListener('fullscreenchange', scheduleMeasure);
document.addEventListener('webkitfullscreenchange', scheduleMeasure);

/* ---------- Fit-to-screen scaling ----------
   Below a game's minimum size the frame is rendered at a larger logical size and scaled down uniformly so the
   game still gets a layout it fits in (at the cost of smaller text). The logical size keeps the usable area's
   aspect ratio, so the scaled frame fills the screen; only sub-pixel rounding is letterboxed (centered, on black).
   At or above the minimum the frame is 1:1 and full-bleed. We never scale up: on large tablets and desktops the
   game just gets the whole screen and handles its own large layout. Browsers map pointer/touch input into a
   transformed iframe natively. */
const DEFAULT_MIN = { portrait: { w: 360, h: 600 }, landscape: { w: 640, h: 360 } };
let currentGame: Game | undefined;

function fitFrame(landscape: boolean): void {
  const frame = frameWrap.querySelector('iframe');
  const min = landscape
    ? { w: currentGame?.minWidthLandscape ?? DEFAULT_MIN.landscape.w, h: currentGame?.minHeightLandscape ?? DEFAULT_MIN.landscape.h }
    : { w: currentGame?.minWidth ?? DEFAULT_MIN.portrait.w, h: currentGame?.minHeight ?? DEFAULT_MIN.portrait.h };
  // Measure the wrapper itself: it is the usable area as laid out by CSS (stage minus safe-area insets).
  const { width: uw, height: uh } = frameWrap.getBoundingClientRect();
  const fit = Math.min(1, uw / min.w, uh / min.h);

  if (!frame || fit >= 1 || uw <= 0 || uh <= 0) {
    frameWrap.classList.remove('is-scaled');
    stage.dataset.scale = '1';
    return;
  }
  const w = Math.max(min.w, Math.floor(uw / fit));
  const h = Math.max(min.h, Math.floor(uh / fit));
  const scale = Math.min(uw / w, uh / h);
  frameWrap.style.setProperty('--frame-w', `${w}px`);
  frameWrap.style.setProperty('--frame-h', `${h}px`);
  frameWrap.style.setProperty('--frame-x', `${(uw - w * scale) / 2}px`);
  frameWrap.style.setProperty('--frame-y', `${(uh - h * scale) / 2}px`);
  frameWrap.style.setProperty('--frame-scale', String(scale));
  frameWrap.classList.add('is-scaled');
  stage.dataset.scale = String(Math.round(scale * 10000) / 10000);
}

measure();

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
attachFeedback(document.getElementById('feedback') as HTMLButtonElement, { mount: stage, currentGame: () => currentGame?.id });

/* ---------- Analytics: play_clicked, game_session_ended, share_clicked ---------- */
let playStart = 0;

function startSession(game: Game): void {
  playStart = performance.now();
  trackEvent('play_clicked', { game_id: game.id, device: matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop' });
}

window.addEventListener('pagehide', () => {
  if (!currentGame || !playStart) return;
  trackEvent('game_session_ended', { game_id: currentGame.id, seconds_played: Math.round((performance.now() - playStart) / 1000) });
  playStart = 0;
});
// Back to this page from the back/forward cache: time the new visit from now.
window.addEventListener('pageshow', (event) => {
  if (event.persisted && currentGame) playStart = performance.now();
});

trackShares(() => currentGame?.id);

/* ---------- Load the game ---------- */
function showMessage(heading: string, message: string): void {
  title.textContent = heading;
  title.classList.remove('visually-hidden');
  frameWrap.replaceChildren(el('div', { class: 'stage-msg' }, title, el('p', {}, message), el('a', { class: 'btn btn-primary', href: '/' }, 'Back to the arcade')));
}

const params = new URLSearchParams(location.search);
const id = params.get('id');

/** The game's address for the frame. A game with a daily challenge gets ?daily=1 (and nothing else) from a link that carries it. */
function frameSrc(game: Game): string {
  const base = game.playUrl.split('#')[0];
  if (!game.daily || params.get('daily') !== '1') return base;
  const url = new URL(base);
  url.searchParams.set('daily', '1');
  return url.href;
}

try {
  const game = (await loadGames()).find((g) => g.id === id);
  if (!game) {
    showMessage('Game not found', "We couldn't find that game. It may have moved.");
  } else if (game.external) {
    // Submitted games run on their own site. Send the visitor there instead of framing it.
    location.replace(game.playUrl);
  } else {
    document.title = `${game.name}: TrueAIGaming`;
    title.textContent = game.name;
    currentGame = game;
    newTab.href = game.playUrl;
    newTab.hidden = false;
    fullscreenBtn.hidden = !canFullscreen;
    // A move link's save (taken off this page's address in play.html) goes only to the game that reads it, inside
    // the frame's #fragment, which is never sent to a server.
    const move = (window as { __tagMove?: unknown }).__tagMove;
    const moveHash = game.moveCode && typeof move === 'string' && /^#move=[A-Za-z0-9_-]+$/.test(move) ? move : '';
    const frame = el('iframe', {
      class: 'game-frame',
      src: frameSrc(game) + moveHash,
      title: game.name,
      allow: 'fullscreen; autoplay; gamepad; clipboard-write; accelerometer; gyroscope; screen-wake-lock; web-share; xr-spatial-tracking',
      allowfullscreen: '',
      referrerpolicy: 'strict-origin-when-cross-origin',
    });
    // Listen before the game loads, so its first message is heard.
    startCloudSaves(game, frame);
    frameWrap.replaceChildren(frame);
    measure();
    startSession(game);
  }
} catch (err) {
  console.error(err);
  showMessage('Something broke', 'Could not load the game list. Please refresh.');
}
