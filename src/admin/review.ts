import '../style.css';
import { ApiError, apiFetch } from '../account/api';
import { SUBMISSIONS_ENABLED } from '../account/client';
import { isBlobThumbnailUrl, validateHttpsUrl } from '../shared/submission-rules.mjs';

const CLOSED = 'Submissions are not open yet';
const LOADING = 'Loading…';
const FALLBACK = 'Something went wrong, try again.';
const ADMINS_ONLY = 'Admins only.';
const NEEDS_NOTE = 'Add a note to reject this game.';
const APPROVED_LIVE = 'Live in a few minutes';
const REBUILD_NOT_STARTED = 'Rebuild not started. Use Republish.';
const REJECTED = 'Rejected.';
const REPUBLISH_STARTED = 'Republish started. The site updates in a few minutes.';
const REPUBLISH_NOT_STARTED = 'Republish did not start. Try again.';

const LIST_PATH = '/api/admin/submissions';
const REPUBLISH_PATH = '/api/admin/republish';

/** A game waiting for review, as GET /api/admin/submissions returns it. Only the fields this page shows are read. */
interface PendingRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  how_it_was_made: string;
  play_url: string;
  source_url: string | null;
  thumbnail_url: string | null;
}

interface ListReply {
  ok: true;
  submissions: PendingRow[];
}

/** Approve and reject reply with the reviewed row. Only approve says whether the site rebuild started. */
interface ReviewReply {
  ok: true;
  rebuild?: { ok: boolean };
}

interface RepublishReply {
  ok: true;
  rebuild: { ok: boolean };
}

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const pageHead = byId<HTMLElement>('page-head');
const notice = byId<HTMLParagraphElement>('notice');
const retry = byId<HTMLButtonElement>('retry');
const reviewBody = byId<HTMLElement>('review-body');
const republishBtn = byId<HTMLButtonElement>('republish-btn');
const republishStatus = byId<HTMLParagraphElement>('republish-status');
const actionStatus = byId<HTMLParagraphElement>('action-status');
const emptyNote = byId<HTMLParagraphElement>('empty');
const list = byId<HTMLUListElement>('pending');

/** The review route for one game. The id is encoded, as it is in every API path. */
function reviewPath(id: string): string {
  return `${LIST_PATH}/${encodeURIComponent(id)}`;
}

/** Builds an element with text children only. Attributes are set with setAttribute, never as markup. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}

/** Null-safe, because the flag-off path calls it at module scope. */
function showNotice(text: string, canRetry = false): void {
  if (notice) {
    notice.textContent = text;
    notice.hidden = text === '';
  }
  if (retry) retry.hidden = !canRetry;
}

function setStatus(out: HTMLElement, text: string, isError = false): void {
  out.textContent = text;
  out.classList.toggle('is-error', isError);
}

/**
 * An ApiError message is written for people to read, so it is shown as it is. A 403 is the admin gate, so it shows the
 * brief's wording. Anything else, such as a network failure or a missing-config error, gets the fixed text.
 */
function messageFor(err: unknown): string {
  if (err instanceof ApiError) return err.status === 403 ? ADMINS_ONLY : err.message;
  return FALLBACK;
}

/** Hides the list's empty note when no card is left. */
function settleEmpty(): void {
  emptyNote.hidden = list.childElementCount > 0;
}

/**
 * A link that opens in a new tab. The address must pass the shared https rule, and the href is set with setAttribute.
 * Null when the address does not pass, so the card shows a plain note instead.
 */
function newTabLink(address: string | null, text: string, className: string): HTMLAnchorElement | null {
  const checked = address === null ? null : validateHttpsUrl(address);
  if (!checked || !checked.ok) return null;
  return el('a', { class: className, href: checked.value, target: '_blank', rel: 'noopener noreferrer' }, text);
}

/** One card for a game waiting for review. Its controls are closures over the card, so each card owns its own state. */
function cardFor(row: PendingRow): HTMLLIElement {
  const id = row.id;
  const noteId = `note-${id}`;
  const status = el('p', { class: 'review-status', role: 'status', 'aria-live': 'polite' });
  const note = el('textarea', { class: 'review-note', id: noteId, rows: '3' });
  const approve = el('button', { class: 'btn btn-primary', type: 'button' }, 'Approve');
  const reject = el('button', { class: 'btn btn-danger', type: 'button' }, 'Reject');
  reject.disabled = true;
  let busy = false;

  /** Reject stays off until the note has text, and while a request is running. */
  const syncReject = (): void => {
    reject.disabled = busy || note.value.trim() === '';
  };

  /** Locks the card's controls while a request runs, and frees them after a failure. */
  const setBusy = (on: boolean): void => {
    busy = on;
    approve.disabled = on;
    note.disabled = on;
    syncReject();
  };

  async function approveCard(): Promise<void> {
    setBusy(true);
    setStatus(status, '');
    try {
      const reply = await apiFetch<ReviewReply>(reviewPath(id), { method: 'POST', body: JSON.stringify({ action: 'approve' }) });
      item.remove();
      settleEmpty();
      setStatus(actionStatus, reply.rebuild?.ok === true ? APPROVED_LIVE : REBUILD_NOT_STARTED);
    } catch (err) {
      setBusy(false);
      setStatus(status, messageFor(err), true);
    }
  }

  async function rejectCard(): Promise<void> {
    // Checked again here, so a reject can never be sent with an empty note.
    const text = note.value.trim();
    if (text === '') {
      setStatus(status, NEEDS_NOTE, true);
      syncReject();
      return;
    }
    setBusy(true);
    setStatus(status, '');
    try {
      await apiFetch<ReviewReply>(reviewPath(id), { method: 'POST', body: JSON.stringify({ action: 'reject', note: text }) });
      item.remove();
      settleEmpty();
      setStatus(actionStatus, REJECTED);
    } catch (err) {
      setBusy(false);
      setStatus(status, messageFor(err), true);
    }
  }

  note.addEventListener('input', syncReject);
  approve.addEventListener('click', () => void approveCard());
  reject.addEventListener('click', () => void rejectCard());

  const thumbUrl = row.thumbnail_url;
  const thumb = thumbUrl !== null && isBlobThumbnailUrl(thumbUrl)
    ? el('img', { class: 'review-thumb', alt: '', loading: 'lazy', decoding: 'async', src: thumbUrl })
    : null;
  const play = newTabLink(row.play_url, 'Play', 'btn btn-primary');
  const source = newTabLink(row.source_url, 'Source', 'btn btn-ghost');

  const item = el(
    'li',
    { class: 'review-card', 'data-id': id },
    ...(thumb ? [thumb] : []),
    el('h2', { class: 'review-name' }, row.name),
    el('p', { class: 'review-owner' }, `Owner ID: ${row.owner_id}`),
    el('p', { class: 'review-description' }, row.description),
    el('h3', { class: 'review-subhead' }, 'How it was made'),
    el('p', { class: 'review-how' }, row.how_it_was_made),
    el(
      'div',
      { class: 'review-links' },
      play ?? el('span', { class: 'review-missing' }, 'No valid play link'),
      source ?? el('span', { class: 'review-missing' }, 'No source link'),
    ),
    el(
      'div',
      { class: 'review-decision' },
      el('label', { class: 'review-label', for: noteId }, 'Note for the owner (needed to reject)'),
      note,
      el('div', { class: 'review-buttons' }, approve, reject),
      status,
    ),
  );
  return item;
}

function showRows(rows: PendingRow[]): void {
  list.replaceChildren(...rows.map(cardFor));
  settleEmpty();
}

/** Loads the games waiting for review. Never rejects. A failure shows in the notice with Try again. */
async function load(): Promise<void> {
  showNotice(LOADING);
  try {
    const reply = await apiFetch<ListReply>(LIST_PATH);
    showRows(reply.submissions);
    showNotice('');
  } catch (err) {
    showNotice(messageFor(err), true);
  }
}

/** Rebuilds the site. The outcome is shown in words only. The rebuild's own error text is never shown. */
async function republish(): Promise<void> {
  republishBtn.disabled = true;
  setStatus(republishStatus, '');
  try {
    const reply = await apiFetch<RepublishReply>(REPUBLISH_PATH, { method: 'POST' });
    setStatus(republishStatus, reply.rebuild.ok === true ? REPUBLISH_STARTED : REPUBLISH_NOT_STARTED);
  } catch (err) {
    setStatus(republishStatus, messageFor(err), true);
  } finally {
    republishBtn.disabled = false;
  }
}

/** Registers the page-level handlers. The card handlers are attached as each card is built. */
function wire(): void {
  republishBtn.addEventListener('click', () => void republish());
}

// The flag is checked before anything else. When it is off, the only thing shown is the notice.
if (!SUBMISSIONS_ENABLED) {
  showNotice(CLOSED);
} else {
  // Registered at module scope, before wire(), so Try again works even when wire() throws on a missing element.
  retry?.addEventListener('click', () => void load());
  // Shown before wire() runs, so a wire() failure leaves the notice and Try again in view with the list around them.
  if (pageHead) pageHead.hidden = false;
  if (reviewBody) reviewBody.hidden = false;
  try {
    wire();
    void load();
  } catch {
    // A missing element in the markup lands here. The fixed text and Try again show, and load() does not run.
    showNotice(FALLBACK, true);
  }
}
