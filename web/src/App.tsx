import { useCallback, useEffect, useState } from 'react';
import { currentUser, logout } from './auth';
import { loadConfig } from './config';
import { LANGS, NATIVE_NAMES, isLang, useI18n, type Lang } from './i18n';
import Login from './pages/Login';
import NewReview from './pages/NewReview';
import ReviewDetail from './pages/ReviewDetail';

export interface PendingReview {
  componentIri: string;
  scenario: string;
  language: Lang;
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

function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();
  return (
    <select
      className="lang-switcher"
      aria-label={t.uiLanguage}
      value={lang}
      onChange={(e) => { if (isLang(e.target.value)) setLang(e.target.value); }}
    >
      {LANGS.map((l) => <option key={l} value={l} lang={l}>{NATIVE_NAMES[l]}</option>)}
    </select>
  );
}

export default function App() {
  const { t } = useI18n();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<unknown>(null);
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
      .catch((e: unknown) => setError(e ?? 'unknown'));
  }, []);

  if (error) return <main className="container"><p className="error">{t.configLoadFailed(error instanceof Error ? error.message : String(error))}</p></main>;
  if (!ready) return <main className="container"><p className="muted">{t.loading}</p></main>;

  const match = path.match(/^\/reviews\/([0-9a-f-]{36})$/);
  return (
    <>
      <header className="topbar">
        <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }} className="brand">B-pillar DFMEA Lite</a>
        <span className="user">
          <LanguageSwitcher />
          {user && (
            <>
              <bdi dir="ltr">{user}</bdi>
              <button className="link" onClick={async () => { await logout(); setUser(null); navigate('/'); }}>{t.logout}</button>
            </>
          )}
        </span>
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
