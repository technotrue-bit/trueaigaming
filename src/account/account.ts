import '../style.css';
import { validateDisplayName, validateHandle, validatePassword } from '../shared/submission-rules.mjs';
import { ApiError, apiFetch } from './api';
import { SUBMISSIONS_ENABLED, supabase } from './client';

const CLOSED = 'Submissions are not open yet';
const LOADING = 'Loading…';
const FALLBACK = 'Something went wrong, try again.';
const DELETE_CONFIRM = "Delete your account and all your games? This can't be undone.";

type Screen = 'signed-out' | 'unverified' | 'verified' | 'handle-setup' | 'new-password';
const SCREENS: Screen[] = ['signed-out', 'unverified', 'verified', 'handle-setup', 'new-password'];

/** The profile routes reply with { ok: true, profile } for GET and POST. */
interface ProfileReply {
  ok: true;
  profile: { handle: string };
}

/** The address the verify panel resends to. Kept in memory only. */
let pendingEmail = '';

/** True from a password-reset link until a new password is saved. While it is set, only the new-password screen shows. */
let recovering = false;

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const pageHead = byId<HTMLElement>('page-head');
const notice = byId<HTMLParagraphElement>('notice');
const retry = byId<HTMLButtonElement>('retry');
const handleText = byId<HTMLElement>('handle');
const signupForm = byId<HTMLFormElement>('signup-form');
const signupSubmit = byId<HTMLButtonElement>('signup-submit');
const signinForm = byId<HTMLFormElement>('signin-form');
const signinSubmit = byId<HTMLButtonElement>('signin-submit');
const forgot = byId<HTMLButtonElement>('forgot');
const resendBtn = byId<HTMLButtonElement>('resend');
const unverifiedSignOut = byId<HTMLButtonElement>('unverified-sign-out');
const signOutBtn = byId<HTMLButtonElement>('sign-out');
const deleteBtn = byId<HTMLButtonElement>('delete');
const handleForm = byId<HTMLFormElement>('handle-form');
const handleSave = byId<HTMLButtonElement>('handle-save');
const handleSignOut = byId<HTMLButtonElement>('handle-sign-out');
const newPasswordForm = byId<HTMLFormElement>('new-password-form');
const newPasswordSave = byId<HTMLButtonElement>('new-password-save');
const statusEls = {
  signup: byId<HTMLElement>('signup-status'),
  signin: byId<HTMLElement>('signin-status'),
  unverified: byId<HTMLElement>('unverified-status'),
  verified: byId<HTMLElement>('verified-status'),
  handle: byId<HTMLElement>('handle-status'),
  newPassword: byId<HTMLElement>('new-password-status'),
};

/** Text of one form field, as typed. */
function fieldValue(form: HTMLFormElement, name: string): string {
  const value = new FormData(form).get(name);
  return typeof value === 'string' ? value : '';
}

function setStatus(el: HTMLElement, text: string, isError = false): void {
  el.textContent = text;
  el.classList.toggle('is-error', isError);
}

function showNotice(text: string, canRetry = false): void {
  notice.textContent = text;
  notice.hidden = text === '';
  retry.hidden = !canRetry;
}

/** Shows one panel and hides the rest. Panel messages are cleared, since they belong to the panel they were shown in. */
function showScreen(screen: Screen | null): void {
  // During a password reset only the new-password panel may show, so a load that finishes late cannot replace it.
  if (recovering && screen !== 'new-password') return;
  for (const id of SCREENS) byId<HTMLElement>(id).hidden = id !== screen;
  for (const el of Object.values(statusEls)) setStatus(el, '');
}

/**
 * An ApiError message is written for people to read, so it is shown as it is. Anything else, such as a Supabase error or
 * the missing-config error (which names VITE_ variables), gets the fixed text.
 */
function messageFor(err: unknown): string {
  return err instanceof ApiError ? err.message : FALLBACK;
}

/** Supabase reports an unconfirmed email with this code. Only the code is read. The message is never shown. */
function isUnverified(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'email_not_confirmed';
}

/** Runs one action from a form or button. The control is disabled while it runs. A failure shows in `out`. */
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

function showUnverified(email: string): void {
  pendingEmail = email;
  showScreen('unverified');
}

/** Loads the profile. A 409 means no usable handle yet, so the handle form appears. Other failures show their message in the notice. */
async function showVerified(): Promise<void> {
  let reply: ProfileReply;
  try {
    reply = await apiFetch<ProfileReply>('/api/profile');
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      showScreen('handle-setup');
      return;
    }
    showScreen(null);
    showNotice(messageFor(err), true);
    return;
  }
  handleText.textContent = reply.profile.handle;
  showScreen('verified');
}

/** Shows the panel that matches the stored session. Never throws. Failures show in the notice. */
async function route(): Promise<void> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    showNotice('');
    if (recovering) return;
    const user = data.session?.user;
    if (!user) {
      showScreen('signed-out');
      return;
    }
    if (!user.email_confirmed_at) {
      showUnverified(user.email ?? '');
      return;
    }
    await showVerified();
  } catch (err) {
    showScreen(null);
    showNotice(messageFor(err), true);
  }
}

function signOutFrom(control: HTMLButtonElement, out: HTMLElement): void {
  void attempt(control, out, async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    await route();
  });
}

function wire(): void {
  // Registered before the first route(), so a password-reset event during session setup is not missed.
  supabase.auth.onAuthStateChange((event) => {
    if (event !== 'PASSWORD_RECOVERY') return;
    recovering = true;
    showScreen('new-password');
  });

  signupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!signupForm.reportValidity()) return;
    // Same rules as the server, so the messages match. The handle and display name become signup metadata.
    const handle = validateHandle(fieldValue(signupForm, 'handle'));
    const displayName = validateDisplayName(fieldValue(signupForm, 'display_name'));
    const password = validatePassword(fieldValue(signupForm, 'password'));
    if (!handle.ok || !displayName.ok || !password.ok) {
      const failure = [handle, displayName, password].find((result) => !result.ok);
      setStatus(statusEls.signup, failure && !failure.ok ? failure.error : FALLBACK, true);
      return;
    }
    const email = fieldValue(signupForm, 'email').trim();
    void attempt(signupSubmit, statusEls.signup, async () => {
      const { error } = await supabase.auth.signUp({
        email,
        password: password.value,
        options: {
          emailRedirectTo: `${location.origin}/account`,
          data: { handle: handle.value, display_name: displayName.value },
        },
      });
      if (error) throw error;
      signupForm.reset();
      setStatus(statusEls.signup, 'Check your email to verify your account.');
    });
  });

  signinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!signinForm.reportValidity()) return;
    const email = fieldValue(signinForm, 'email').trim();
    const password = fieldValue(signinForm, 'password');
    void attempt(signinSubmit, statusEls.signin, async () => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      // Supabase refuses sign-in until the email is verified. Send the person to the verify panel so Resend is reachable.
      if (isUnverified(error)) {
        showUnverified(email);
        return;
      }
      if (error) throw error;
      await route();
    });
  });

  forgot.addEventListener('click', () => {
    const email = fieldValue(signinForm, 'email').trim();
    if (!email) {
      setStatus(statusEls.signin, 'Enter your email address first.', true);
      return;
    }
    void attempt(forgot, statusEls.signin, async () => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/account` });
      if (error) throw error;
      setStatus(statusEls.signin, 'If an account exists for that email, a reset link is on its way.');
    });
  });

  resendBtn.addEventListener('click', () => {
    void attempt(resendBtn, statusEls.unverified, async () => {
      const { error } = await supabase.auth.resend({ type: 'signup', email: pendingEmail });
      if (error) throw error;
      setStatus(statusEls.unverified, 'Verification email sent. Check your inbox.');
    });
  });

  unverifiedSignOut.addEventListener('click', () => signOutFrom(unverifiedSignOut, statusEls.unverified));
  signOutBtn.addEventListener('click', () => signOutFrom(signOutBtn, statusEls.verified));

  deleteBtn.addEventListener('click', () => {
    if (!window.confirm(DELETE_CONFIRM)) return;
    void attempt(deleteBtn, statusEls.verified, async () => {
      await apiFetch('/api/profile', { method: 'DELETE' });
      // The account is gone on the server. Clear this browser's session. supabase-js (auth-js 2.118) removes the local session
      // even when the server sign-out fails, and then returns that error. Show it after route() has run.
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      await route();
      // Same check as the password path: a route() error keeps its Try again button and is not overwritten.
      if (notice.hidden) showNotice(error ? FALLBACK : 'Your account and games were deleted.');
    });
  });

  handleForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!handleForm.reportValidity()) return;
    const checked = validateHandle(fieldValue(handleForm, 'handle'));
    if (!checked.ok) {
      setStatus(statusEls.handle, checked.error, true);
      return;
    }
    void attempt(handleSave, statusEls.handle, async () => {
      const reply = await apiFetch<ProfileReply>('/api/profile', {
        method: 'POST',
        body: JSON.stringify({ handle: checked.value }),
      });
      handleText.textContent = reply.profile.handle;
      showScreen('verified');
    });
  });

  handleSignOut.addEventListener('click', () => signOutFrom(handleSignOut, statusEls.handle));

  newPasswordForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!newPasswordForm.reportValidity()) return;
    const result = validatePassword(fieldValue(newPasswordForm, 'password'));
    if (!result.ok) {
      setStatus(statusEls.newPassword, result.error, true);
      return;
    }
    const password = result.value;
    void attempt(newPasswordSave, statusEls.newPassword, async () => {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      recovering = false;
      await route();
      // route() clears the notice on success. Show this line only when no route() error is showing.
      if (notice.hidden) showNotice('Password updated.');
    });
  });

}

// The flag is checked before anything else. When it is off, the only thing shown is the notice.
if (!SUBMISSIONS_ENABLED) {
  showNotice(CLOSED);
} else {
  pageHead.hidden = false;
  showNotice(LOADING);
  // Registered outside wire(), so Try again works even when wire() throws on a missing config.
  retry.addEventListener('click', () => void route());
  try {
    wire();
  } catch {
    // The Supabase client throws on first use when its settings are missing. The fixed text and Try again show instead.
    showNotice(FALLBACK, true);
  }
  void route();
}
