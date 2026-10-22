import '../style.css';
import { ApiError, apiFetch } from './api';
import { SUBMISSIONS_ENABLED } from './client';

const CLOSED = 'Submissions are not open yet';
const LOADING = 'Loading…';
const FALLBACK = 'Something went wrong, try again.';
const DELETE_CONFIRM = "Delete this game? This can't be undone.";

/** A game as GET /api/submissions returns it. Only the fields this page shows are read. */
interface SubmissionRow {
  id: string;
  name: string;
  status: string;
  review_note: string | null;
}

interface ListReply {
  ok: true;
  submissions: SubmissionRow[];
}

/** DELETE says whether the game was live, and whether the site rebuild that follows worked. Its error text is never shown. */
interface DeleteReply {
  ok: true;
  wasApproved: boolean;
  rebuild: { ok: boolean } | null;
}

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const pageHead = byId<HTMLElement>('page-head');
const notice = byId<HTMLParagraphElement>('notice');
const retry = byId<HTMLButtonElement>('retry');
const createdNote = byId<HTMLParagraphElement>('created-note');
const actionStatus = byId<HTMLParagraphElement>('action-status');
const emptyNote = byId<HTMLParagraphElement>('empty');
const list = byId<HTMLUListElement>('games');

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

function setActionStatus(text: string, isError = false): void {
  actionStatus.textContent = text;
  actionStatus.classList.toggle('is-error', isError);
}

/**
 * An ApiError message is written for people to read, so it is shown as it is. Anything else, such as a network failure or
 * a missing-config error, gets the fixed text.
 */
function messageFor(err: unknown): string {
  return err instanceof ApiError ? err.message : FALLBACK;
}

/** The status line for one game. Text only. A rejected game shows the note the reviewer wrote. */
function statusLine(row: SubmissionRow): string {
  if (row.status === 'approved') return 'Live';
  if (row.status === 'rejected') {
    const note = row.review_note?.trim() ?? '';
    return note ? `Not approved: ${note}` : 'Not approved';
  }
  return 'Waiting for review';
}

/** One game row. Edit goes to the submit page in edit mode. The id is encoded, as it is in every API path. */
function gameItem(row: SubmissionRow): HTMLLIElement {
  return el(
    'li',
    { class: 'my-game', 'data-id': row.id },
    el(
      'div',
      { class: 'my-game-info' },
      el('h2', { class: 'my-game-name' }, row.name),
      el('p', { class: 'my-game-status' }, statusLine(row)),
    ),
    el(
      'div',
      { class: 'my-game-actions' },
      el('a', { class: 'btn btn-ghost', href: `/submit?edit=${encodeURIComponent(row.id)}` }, 'Edit'),
      el('button', { class: 'btn btn-danger', type: 'button', 'data-action': 'delete', 'aria-label': `Delete ${row.name}` }, 'Delete'),
    ),
  );
}

function showRows(rows: SubmissionRow[]): void {
  list.replaceChildren(...rows.map(gameItem));
  emptyNote.hidden = rows.length > 0;
}

/** The result of a delete, in words. The rebuild's own error text is never shown. */
function deleteOutcome(reply: DeleteReply): string {
  if (!reply.wasApproved) return 'Deleted.';
  return reply.rebuild?.ok === true ? 'Deleted. The game will leave the site in a few minutes.' : 'Deleted, but the site did not update.';
}

/** Deletes one game after a confirm. The row leaves the list on success. Any failure shows the fixed text. */
async function deleteGame(item: HTMLLIElement, id: string, control: HTMLButtonElement): Promise<void> {
  if (!window.confirm(DELETE_CONFIRM)) return;
  control.disabled = true;
  setActionStatus('');
  try {
    const reply = await apiFetch<DeleteReply>(`/api/submissions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    item.remove();
    emptyNote.hidden = list.childElementCount > 0;
    setActionStatus(deleteOutcome(reply));
  } catch {
    control.disabled = false;
    setActionStatus(FALLBACK, true);
  }
}

/** Loads the signed-in person's games. Never rejects. A failure shows in the notice with Try again. */
async function load(): Promise<void> {
  showNotice(LOADING);
  try {
    const reply = await apiFetch<ListReply>('/api/submissions');
    showRows(reply.submissions);
    showNotice('');
  } catch (err) {
    showNotice(messageFor(err), true);
  }
}

/** Registers the Delete handler on the list. The rows are built later, so one handler covers them all. */
function wire(): void {
  list.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || target.dataset.action !== 'delete') return;
    const item = target.closest('li');
    const id = item?.dataset.id;
    if (!item || !id) return;
    void deleteGame(item, id, target);
  });
}

// The flag is checked before anything else. When it is off, the only thing shown is the notice.
if (!SUBMISSIONS_ENABLED) {
  showNotice(CLOSED);
} else {
  // Registered outside wire(), so Try again works even when wire() throws on a missing element.
  retry?.addEventListener('click', () => void load());
  try {
    wire();
    pageHead.hidden = false;
    if (createdNote) createdNote.hidden = new URLSearchParams(location.search).get('created') !== '1';
    void load();
  } catch {
    // wire() failed, so the list is not loaded here. Try again loads it.
    showNotice(FALLBACK, true);
  }
}
