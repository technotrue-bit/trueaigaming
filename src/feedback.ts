import { trackEvent } from './analytics';
import { el, loadGames } from './games';

const MAX_MESSAGE = 2000;
const MAX_CONTACT = 200;
const GAME_ID = /^[a-z0-9-]+$/;
const TITLE = 'Report a bug or add suggestions!';

interface FeedbackOptions {
  /** Where to mount the dialog. On the play page this must be inside the fullscreen element. */
  mount?: HTMLElement;
  /** Game to preselect, read at open time (the play page learns it after games.json loads). */
  currentGame?: () => string | undefined;
}

let uid = 0;

/** Wire a trigger button to a lazily built feedback dialog. All text goes in via textContent (el helper). */
export function attachFeedback(trigger: HTMLButtonElement, { mount = document.body, currentGame }: FeedbackOptions = {}): void {
  let ui: ReturnType<typeof build> | null = null;
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.addEventListener('click', () => {
    ui ??= build(mount);
    ui.open(currentGame?.());
  });
}

function build(mount: HTMLElement) {
  const n = ++uid;
  const ids = { title: `fb-title-${n}`, msg: `fb-msg-${n}`, count: `fb-count-${n}`, game: `fb-game-${n}`, contact: `fb-contact-${n}`, hp: `fb-hp-${n}` };

  const radio = (value: string, label: string, checked: boolean) =>
    el('label', { class: 'fb-toggle' }, el('input', { type: 'radio', name: 'type', value, ...(checked ? { checked: '' } : {}) }), el('span', {}, label));

  const gameSelect = el('select', { id: ids.game, name: 'game' }, el('option', { value: '' }, 'Not about a specific game'));
  const message = el('textarea', { id: ids.msg, name: 'message', required: '', maxlength: String(MAX_MESSAGE), rows: '5', 'aria-describedby': ids.count });
  const counter = el('span', { id: ids.count, class: 'fb-count' }, `0 / ${MAX_MESSAGE}`);
  const contact = el('input', { id: ids.contact, name: 'contact', type: 'text', maxlength: String(MAX_CONTACT), autocomplete: 'email' });
  const honeypot = el('input', { id: ids.hp, name: 'website', type: 'text', tabindex: '-1', autocomplete: 'off' });
  const status = el('p', { class: 'fb-status', role: 'status', 'aria-live': 'polite' });
  const sendBtn = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Send');

  const form = el(
    'form',
    { class: 'fb-form', novalidate: '' },
    el('fieldset', { class: 'fb-types' }, el('legend', { class: 'visually-hidden' }, 'Feedback type'), radio('bug', '🐞 Bug', true), radio('suggestion', '💡 Suggestion', false)),
    el('label', { class: 'fb-label', for: ids.game }, 'Game (optional)'),
    gameSelect,
    el('div', { class: 'fb-row' }, el('label', { class: 'fb-label', for: ids.msg }, 'Message'), counter),
    message,
    el('label', { class: 'fb-label', for: ids.contact }, 'Contact (optional, if you want a reply)'),
    contact,
    el('div', { class: 'fb-hp', 'aria-hidden': 'true' }, el('label', { for: ids.hp }, 'Website'), honeypot),
    status,
    el('div', { class: 'fb-actions' }, sendBtn),
  );

  const doneMsg = el('p', { class: 'fb-done-msg', tabindex: '-1' }, 'Thanks! Your feedback was sent.');
  const anotherBtn = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Send another');
  const doneCloseBtn = el('button', { class: 'btn btn-primary', type: 'button' }, 'Close');
  const done = el('div', { class: 'fb-done' }, doneMsg, el('div', { class: 'fb-actions' }, anotherBtn, doneCloseBtn));
  done.hidden = true;

  const closeBtn = el('button', { class: 'fb-close', type: 'button', 'aria-label': 'Close' }, '✕');
  const dialog = el(
    'dialog',
    { class: 'fb-dialog', 'aria-labelledby': ids.title },
    el('div', { class: 'fb-head' }, el('h2', { id: ids.title, class: 'fb-title' }, TITLE), closeBtn),
    form,
    done,
  );
  mount.append(dialog);

  let gamesLoaded: Promise<void> | null = null;
  const loadGameOptions = () =>
    (gamesLoaded ??= loadGames()
      .then((games) => gameSelect.append(...games.filter((g) => GAME_ID.test(g.id) && g.id.length <= 80).map((g) => el('option', { value: g.id }, g.name))))
      .catch((err) => console.warn('feedback: could not load games', err)));

  const setStatus = (text: string, isError = false) => {
    status.textContent = text;
    status.classList.toggle('is-error', isError);
  };
  const updateCount = () => (counter.textContent = `${message.value.length} / ${MAX_MESSAGE}`);

  const showForm = () => {
    form.reset();
    updateCount();
    setStatus('');
    done.hidden = true;
    form.hidden = false;
  };

  message.addEventListener('input', updateCount);
  closeBtn.addEventListener('click', () => dialog.close());
  doneCloseBtn.addEventListener('click', () => dialog.close());
  anotherBtn.addEventListener('click', () => {
    showForm();
    message.focus();
  });
  // Click on the backdrop (outside the panel) closes.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = message.value.trim();
    if (!text) {
      setStatus('Please write a message first.', true);
      message.focus();
      return;
    }
    const type = (form.elements.namedItem('type') as RadioNodeList).value === 'suggestion' ? 'suggestion' : 'bug';
    const payload = { type, game: gameSelect.value, message: text, contact: contact.value.trim(), website: honeypot.value };

    sendBtn.disabled = true;
    setStatus('Sending…');
    let error = 'Could not send your feedback. Please try again.';
    try {
      const res = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (res.ok) {
        // Never the message or contact.
        trackEvent('feedback_sent', { game_id: payload.game || 'general', rating: type });
        form.hidden = true;
        done.hidden = false;
        doneMsg.focus();
        return;
      }
      if (res.status === 429) error = 'Too many reports from you just now. Please try again in a few minutes.';
    } catch {
      // Network failure: keep the generic message.
    } finally {
      sendBtn.disabled = false;
    }
    setStatus(error, true);
  });

  return {
    async open(gameId?: string) {
      if (dialog.open) return;
      showForm();
      dialog.showModal();
      message.focus();
      await loadGameOptions();
      if (gameId && !gameSelect.value && [...gameSelect.options].some((o) => o.value === gameId)) gameSelect.value = gameId;
    },
  };
}
