/**
 * The Sign in pill at the top of the home page. It shows only when the build turns accounts on, so a closed site has no
 * way in that leads nowhere. It reads this browser's saved Supabase session key without loading the Supabase client,
 * so the home page stays light: with a session it says "My account", otherwise "Sign in".
 */
const pill = document.getElementById('account-pill');
const label = document.getElementById('account-pill-label');

/** supabase-js saves the session under sb-<project ref>-auth-token, where the ref is the first label of the project host. */
function hasSavedSession(): boolean {
  const url: string | undefined = import.meta.env.VITE_SUPABASE_URL;
  if (!url) return false;
  try {
    const ref = new URL(url).hostname.split('.')[0];
    return localStorage.getItem(`sb-${ref}-auth-token`) !== null;
  } catch {
    // A bad URL or blocked storage: show Sign in, and the account page sorts out the rest.
    return false;
  }
}

if (pill && label && import.meta.env.VITE_SUBMISSIONS_ENABLED === 'true') {
  if (hasSavedSession()) label.textContent = 'My account';
  pill.hidden = false;
}
