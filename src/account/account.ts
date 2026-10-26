import '../style.css';
import { checkSignupAge, validateDisplayName, validateHandle, validatePassword } from '../shared/submission-rules.mjs';
import { ApiError, apiFetch } from './api';
import { CaptchaError, CaptchaSlot } from './captcha';
import { SUBMISSIONS_ENABLED, supabase } from './client';

const CLOSED = "Sharing your own game isn't open yet. Check back soon.";
const LOADING = 'Loading…';
const FALLBACK = 'Something went wrong, try again.';
const DELETE_CONFIRM = "Delete your account and all your games? This can't be undone.";
/** Set for the rest of the browser session once the age check says no, so going back and changing the date does not help. */
const AGE_BLOCK_KEY = 'tag-signup-closed';

type Screen = 'signed-out' | 'unverified' | 'verified' | 'handle-setup' | 'new-password';
/** The two tabs of the signed-out card. */
type AuthTab = 'signin' | 'signup';
const AUTH_TABS: AuthTab[] = ['signin', 'signup'];
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

/** The open tab of the signed-out card. A link to /account#create opens on Create account. */
let authTab: AuthTab = location.hash === '#create' ? 'signup' : 'signin';

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const pageHead = byId<HTMLElement>('page-head');
const notice = byId<HTMLParagraphElement>('notice');
const retry = byId<HTMLButtonElement>('retry');
const handleText = byId<HTMLElement>('handle');
const signupForm = byId<HTMLFormElement>('signup-form');
const signupSubmit = byId<HTMLButtonElement>('signup-submit');
const signupClosed = byId<HTMLParagraphElement>('signup-closed');
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
const captcha = {
  signup: new CaptchaSlot(byId<HTMLElement>('signup-captcha')),
  signin: new CaptchaSlot(byId<HTMLElement>('signin-captcha')),
  resend: new CaptchaSlot(byId<HTMLElement>('resend-captcha')),
};
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
  // Only the open tab's bot check renders, since Turnstile does not render into a hidden box.
  if (screen === 'signed-out') captcha[authTab].start();
  if (screen === 'unverified') captcha.resend.start();
}

/**
 * An ApiError message is written for people to read, so it is shown as it is. Anything else, such as a Supabase error or
 * the missing-config error (which names VITE_ variables), gets the fixed text.
 */
function messageFor(err: unknown): string {
  return err instanceof ApiError || err instanceof CaptchaError ? err.message : FALLBACK;
}

/** Storage can be blocked, such as in some private windows. Then the block lasts only until the page reloads. */
function ageBlocked(): boolean {
  try {
    return sessionStorage.getItem(AGE_BLOCK_KEY) === '1';
  } catch {
    return false;
  }
}

/** Hides the sign-up form for this session. Sign-in stays, since someone else may share the device. */
function closeSignup(): void {
  try {
    sessionStorage.setItem(AGE_BLOCK_KEY, '1');
  } catch {
    // Blocked storage: the form still closes for this page view.
  }
  signupForm.reset();
  signupForm.hidden = true;
  signupClosed.hidden = false;
}

/**
 * Runs one Supabase call that needs a bot-check token, then readies a fresh token, since each works once. A check
 * the person has not finished yet is left as it is.
 */
async function withCaptcha(slot: CaptchaSlot, call: (token: string | undefined) => Promise<void>): Promise<void> {
  const token = await slot.token();
  try {
    await call(token);
  } finally {
    slot.reset();
  }
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

/** Opens one tab of the signed-out card. `focus` moves focus to the tab, for keyboard use. */
function showTab(tab: AuthTab, focus = false): void {
  authTab = tab;
  for (const name of AUTH_TABS) {
    const button = byId<HTMLButtonElement>(`tab-${name}`);
    const open = name === tab;
    button.setAttribute('aria-selected', String(open));
    button.tabIndex = open ? 0 : -1;
    byId<HTMLElement>(`${name}-pane`).hidden = !open;
  }
  if (focus) byId<HTMLButtonElement>(`tab-${tab}`).focus();
  if (!byId<HTMLElement>('signed-out').hidden) captcha[tab].start();
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
  if (ageBlocked()) {
    signupForm.hidden = true;
    signupClosed.hidden = false;
  }

  showTab(authTab);
  for (const name of AUTH_TABS) {
    const button = byId<HTMLButtonElement>(`tab-${name}`);
    button.addEventListener('click', () => showTab(name));
    // Arrow keys move between the two tabs, as in any tab list.
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      showTab(name === 'signin' ? 'signup' : 'signin', true);
    });
  }
  for (const link of document.querySelectorAll<HTMLButtonElement>('button[data-tab]')) {
    const tab = link.dataset.tab;
    if (tab === 'signin' || tab === 'signup') link.addEventListener('click', () => showTab(tab, true));
  }

  // Registered before the first route(), so a password-reset event during session setup is not missed.
  supabase.auth.onAuthStateChange((event) => {
    if (event !== 'PASSWORD_RECOVERY') return;
    recovering = true;
    showScreen('new-password');
  });

  signupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!signupForm.reportValidity()) return;
    // The age check runs first, and nothing typed is sent anywhere when it says no. The date itself is never stored.
    const age = checkSignupAge(fieldValue(signupForm, 'birth_month'), fieldValue(signupForm, 'birth_year').trim());
    if (!age.ok) {
      setStatus(statusEls.signup, age.error, true);
      return;
    }
    if (age.value === 'too-young') {
      closeSignup();
      return;
    }
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
      await withCaptcha(captcha.signup, async (captchaToken) => {
        const { error } = await supabase.auth.signUp({
          email,
          password: password.value,
          options: {
            emailRedirectTo: `${location.origin}/account`,
            captchaToken,
            // age_confirmed records only that the age check passed. The server makes no profile without it.
            data: { handle: handle.value, display_name: displayName.value, age_confirmed: true },
          },
        });
        if (error) throw error;
      });
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
      let unverified = false;
      await withCaptcha(captcha.signin, async (captchaToken) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
        // Supabase refuses sign-in until the email is verified. Send the person to the verify panel so Resend is reachable.
        unverified = isUnverified(error);
        if (error && !unverified) throw error;
      });
      if (unverified) {
        showUnverified(email);
        return;
      }
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
      await withCaptcha(captcha.signin, async (captchaToken) => {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${location.origin}/account`,
          captchaToken,
        });
        if (error) throw error;
      });
      setStatus(statusEls.signin, 'If an account exists for that email, a reset link is on its way.');
    });
  });

  resendBtn.addEventListener('click', () => {
    void attempt(resendBtn, statusEls.unverified, async () => {
      await withCaptcha(captcha.resend, async (captchaToken) => {
        const { error } = await supabase.auth.resend({ type: 'signup', email: pendingEmail, options: { captchaToken } });
        if (error) throw error;
      });
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

// The flag is checked before anything else. When it is off, only the page head (with its way back) and the notice show.
if (!SUBMISSIONS_ENABLED) {
  pageHead.hidden = false;
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
