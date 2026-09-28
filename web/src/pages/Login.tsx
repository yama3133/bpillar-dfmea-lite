import { useState } from 'react';
import { login } from '../auth';

export default function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1>サインイン</h1>
      <label>メールアドレス<input type="email" value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" /></label>
      <label>パスワード<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></label>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? 'サインイン中…' : 'サインイン'}</button>
    </form>
  );
}
