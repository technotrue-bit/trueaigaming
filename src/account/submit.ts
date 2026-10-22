import '../style.css';
import { slugFromName, validateSubmission, type SubmissionFields } from '../shared/submission-rules.mjs';
import { ApiError, apiFetch } from './api';
import { SUBMISSIONS_ENABLED, supabase } from './client';

const CLOSED = 'Submissions are not open yet';
const LOADING = 'Loading…';
const FALLBACK = 'Something went wrong, try again.';
const CREATED_URL = '/account/submissions?created=1';
/** Counter limits only. The validation limits live in the shared rules. */
const DESCRIPTION_MAX = 140;
const HOW_MAX = 600;

type Screen = 'signed-out' | 'unverified' | 'form';

/** A game as the API returns it: snake_case, as stored. */
interface SubmissionRow {
  id: string;
  name: string;
  slug: string;
  description: string;
  how_it_was_made: string;
  play_url: string;
  source_url: string | null;
  thumbnail_url: string | null;
  min_players: number;
  max_players: number;
  status: string;
}

interface SubmissionReply {
  ok: true;
  submission: SubmissionRow;
}

/** PATCH also says whether the site rebuild started. `null` means no rebuild was needed. */
interface SaveReply extends SubmissionReply {
  wasApproved: boolean;
  rebuild: { ok: boolean } | null;
}

interface ThumbnailReply {
  ok: true;
  url: string;
}

/** The game to edit, from ?edit=<id>. Null means a new game. */
const editId: string | null = new URLSearchParams(location.search).get('edit') || null;

/** The saved game being edited. Null for a new game. Its thumbnail is kept when no new file is picked. */
let editing: SubmissionRow | null = null;

/** Once true, the address no longer follows the name. It is set when the person edits the address or a saved game loads. */
let slugTouched = false;

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const pageHead = byId<HTMLElement>('page-head');
const pageTitle = byId<HTMLElement>('page-title');
const notice = byId<HTMLParagraphElement>('notice');
const retry = byId<HTMLButtonElement>('retry');
const submitForm = byId<HTMLFormElement>('submit-form');
const editNote = byId<HTMLElement>('edit-note');
const nameInput = byId<HTMLInputElement>('name');
const slugInput = byId<HTMLInputElement>('slug');
const descriptionInput = byId<HTMLTextAreaElement>('description');
const descriptionCount = byId<HTMLElement>('description-count');
const howInput = byId<HTMLTextAreaElement>('how-it-was-made');
const howCount = byId<HTMLElement>('how-count');
const playInput = byId<HTMLInputElement>('play-url');
const sourceInput = byId<HTMLInputElement>('source-url');
const thumbnailInput = byId<HTMLInputElement>('thumbnail');
const minInput = byId<HTMLInputElement>('min-players');
const maxInput = byId<HTMLInputElement>('max-players');
const submitStatus = byId<HTMLElement>('submit-status');
const submitBtn = byId<HTMLButtonElement>('submit-btn');
const panels: Record<Screen, HTMLElement> = {
  'signed-out': byId<HTMLElement>('signed-out'),
  unverified: byId<HTMLElement>('unverified'),
  form: submitForm,
};

function setStatus(el: HTMLElement, text: string, isError = false): void {
  el.textContent = text;
  el.classList.toggle('is-error', isError);
}

function showNotice(text: string, canRetry = false): void {
  notice.textContent = text;
  notice.hidden = text === '';
  retry.hidden = !canRetry;
}

/** Shows one panel and hides the others. Null hides them all. */
function showScreen(screen: Screen | null): void {
  for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== screen;
}

/**
 * An ApiError message is written for people to read, so it is shown as it is. Anything else, such as a Supabase error or
 * the missing-config error, gets the fixed text.
 */
function messageFor(err: unknown): string {
  return err instanceof ApiError ? err.message : FALLBACK;
}

/** Runs one action from a button. The button is disabled while it runs. A failure shows in `out`. */
async function attempt(control: HTMLButtonElement, out: HTMLElement, task: () => Promise<void>): Promise<void> {
  control.disabled = true;
  setStatus(out, '');
  try {
    await task();
  } catch (err) {
    setStatus(out, messageFor(err), true);
  } finally {
    control.disabled = false;
  }
}

/** Counts code points in the trimmed text, as the server does, and shows "n / max". */
function updateCount(input: HTMLTextAreaElement, out: HTMLElement, max: number): void {
  const length = [...input.value.trim()].length;
  out.textContent = `${length} / ${max}`;
  out.classList.toggle('is-error', length > max);
}

function updateCounts(): void {
  updateCount(descriptionInput, descriptionCount, DESCRIPTION_MAX);
  updateCount(howInput, howCount, HOW_MAX);
}

/** Fills the form from a saved game, for edit mode. */
function fillForm(row: SubmissionRow): void {
  editing = row;
  slugTouched = true;
  nameInput.value = row.name;
  slugInput.value = row.slug;
  descriptionInput.value = row.description;
  howInput.value = row.how_it_was_made;
  playInput.value = row.play_url;
  sourceInput.value = row.source_url ?? '';
  minInput.value = String(row.min_players);
  maxInput.value = String(row.max_players);
  updateCounts();
  editNote.hidden = row.status !== 'approved';
  pageTitle.textContent = 'Edit your game';
  submitBtn.textContent = 'Save changes';
}

/**
 * Shows the panel for the stored session, and loads the game in edit mode. Never throws. Failures show in the notice
 * with Try again.
 */
async function route(): Promise<void> {
  showScreen(null);
  showNotice(LOADING);
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    const user = data.session?.user;
    if (!user) {
      showNotice('');
      showScreen('signed-out');
      return;
    }
    if (!user.email_confirmed_at) {
      showNotice('');
      showScreen('unverified');
      return;
    }
    if (editId !== null) {
      const reply = await apiFetch<SubmissionReply>(`/api/submissions/${encodeURIComponent(editId)}`);
      fillForm(reply.submission);
    }
    showNotice('');
    showScreen('form');
  } catch (err) {
    showScreen(null);
    showNotice(messageFor(err), true);
  }
}

/** Uploads the picked file as raw bytes. The server checks the bytes against the declared type. Returns the hosted URL. */
async function uploadThumbnail(file: File): Promise<string> {
  const reply = await apiFetch<ThumbnailReply>('/api/submissions/thumbnail', {
    method: 'POST',
    body: file,
    // apiFetch sets Content-Type only for text bodies, so the file's own type is set here.
    headers: { 'Content-Type': file.type },
  });
  return reply.url;
}

/** Creates the game, or saves the edit. A newly picked thumbnail is uploaded first. */
async function save(fields: SubmissionFields, file: File | null): Promise<void> {
  const thumbnailUrl = file ? await uploadThumbnail(file) : fields.thumbnailUrl;
  const body = JSON.stringify({
    name: fields.name,
    slug: fields.slug,
    description: fields.description,
    how_it_was_made: fields.howItWasMade,
    play_url: fields.playUrl,
    source_url: fields.sourceUrl,
    thumbnail_url: thumbnailUrl,
    min_players: fields.minPlayers,
    max_players: fields.maxPlayers,
  });

  if (editId === null) {
    await apiFetch<SubmissionReply>('/api/submissions', { method: 'POST', body });
    location.assign(CREATED_URL);
    return;
  }

  const reply = await apiFetch<SaveReply>(`/api/submissions/${encodeURIComponent(editId)}`, { method: 'PATCH', body });
  editing = reply.submission;
  editNote.hidden = reply.submission.status !== 'approved';
  thumbnailInput.value = '';
  setStatus(submitStatus, reply.rebuild?.ok === false ? 'Saved, but the site did not update.' : 'Saved.');
}

/** Registers every form handler. None of them touch the Supabase client, so they are safe before the session loads. */
function wire(): void {
  nameInput.addEventListener('input', () => {
    if (!slugTouched) slugInput.value = slugFromName(nameInput.value);
  });
  slugInput.addEventListener('input', () => {
    slugTouched = true;
  });
  descriptionInput.addEventListener('input', () => updateCount(descriptionInput, descriptionCount, DESCRIPTION_MAX));
  howInput.addEventListener('input', () => updateCount(howInput, howCount, HOW_MAX));

  submitForm.addEventListener('submit', (event) => {
    event.preventDefault();
    // The shared rules run here, so the messages match the server. The server checks the thumbnail file.
    const checked = validateSubmission({
      name: nameInput.value,
      slug: slugInput.value,
      description: descriptionInput.value,
      howItWasMade: howInput.value,
      playUrl: playInput.value,
      sourceUrl: sourceInput.value,
      thumbnailUrl: editing?.thumbnail_url ?? null,
      minPlayers: minInput.valueAsNumber,
      maxPlayers: maxInput.valueAsNumber,
    });
    if (!checked.ok) {
      setStatus(submitStatus, checked.error, true);
      return;
    }
    const fields = checked.value;
    const file = thumbnailInput.files?.[0] ?? null;
    void attempt(submitBtn, submitStatus, () => save(fields, file));
  });

  updateCounts();
}

// The flag is checked before anything else. When it is off, the only thing shown is the notice.
if (!SUBMISSIONS_ENABLED) {
  showNotice(CLOSED);
} else {
  pageHead.hidden = false;
  // Registered outside wire(), so Try again works even when wire() throws.
  retry.addEventListener('click', () => void route());
  try {
    wire();
  } catch {
    // A missing element would throw here. The fixed text and Try again show instead.
    showNotice(FALLBACK, true);
  }
  void route();
}
