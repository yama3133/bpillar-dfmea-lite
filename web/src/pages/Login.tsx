import { useState } from 'react';
import { login } from '../auth';
import { errorText } from '../errors';
import { useI18n } from '../i18n';

export default function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  return (
    <form
      className="card narrow"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await login(username, password);
          onSignedIn();
        } catch (err) {
          setError(err ?? 'unknown');
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1>{t.signInTitle}</h1>
      <label>{t.email}<input type="email" dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" /></label>
      <label>{t.password}<input type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></label>
      {error !== null && <p className="error">{errorText(t, error)}</p>}
      <button type="submit" disabled={busy}>{busy ? t.signingIn : t.signIn}</button>
    </form>
  );
}
