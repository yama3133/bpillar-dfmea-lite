import { useCallback, useEffect, useState } from 'react';
import { currentUser, logout } from './auth';
import { loadConfig } from './config';
import Login from './pages/Login';
import NewReview from './pages/NewReview';
import ReviewDetail from './pages/ReviewDetail';

export interface PendingReview {
  componentIri: string;
  scenario: string;
}

function usePath(): [string, (p: string) => void] {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((p: string) => {
    window.history.pushState(null, '', p);
    setPath(p);
  }, []);
  return [path, navigate];
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, PendingReview>>({});
  const [path, navigate] = usePath();

  useEffect(() => {
    loadConfig()
      .then(currentUser)
      .then((u) => {
        setUser(u);
        setReady(true);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <main className="container"><p className="error">設定の読み込みに失敗しました: {error}</p></main>;
  if (!ready) return <main className="container"><p className="muted">読み込み中…</p></main>;

  const match = path.match(/^\/reviews\/([0-9a-f-]{36})$/);
  return (
    <>
      <header className="topbar">
        <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }} className="brand">B-pillar DFMEA Lite</a>
        {user && (
          <span className="user">
            {user}
            <button className="link" onClick={async () => { await logout(); setUser(null); navigate('/'); }}>ログアウト</button>
          </span>
        )}
      </header>
      <main className="container">
        {!user ? (
          <Login onSignedIn={async () => setUser(await currentUser())} />
        ) : match ? (
          <ReviewDetail
            key={match[1]}
            reviewId={match[1]}
            pending={pending[match[1]]}
            onCreated={() => setPending((p) => { const n = { ...p }; delete n[match[1]]; return n; })}
          />
        ) : (
          <NewReview
            onStart={(id, req) => {
              setPending((p) => ({ ...p, [id]: req }));
              navigate(`/reviews/${id}`);
            }}
          />
        )}
      </main>
    </>
  );
}
