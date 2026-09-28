import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import type { PendingReview } from '../App';
import EventTimeline from '../components/EventTimeline';
import FindingsTable from '../components/FindingsTable';
import HitlPanel from '../components/HitlPanel';
import { localName, TERMINAL, type ReviewEvent, type ReviewResponse } from '../types';
import { openReviewSocket } from '../ws';

const REFRESH_ON = new Set(['ontology.pinned', 'findings.proposed', 'validation.result', 'hitl.required', 'hitl.decided', 'review.completed', 'review.failed']);

interface Props {
  reviewId: string;
  pending?: PendingReview;
  onCreated: () => void;
}

export default function ReviewDetail({ reviewId, pending, onCreated }: Props) {
  const [events, setEvents] = useState<Map<number, ReviewEvent>>(new Map());
  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const lastSeq = useRef(0);
  const created = useRef(false);
  const terminal = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setReview(await api.getReview(reviewId));
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) setError((e as Error).message);
    }
  }, [reviewId]);

  const merge = useCallback((list: ReviewEvent[]) => {
    if (!list.length) return;
    setEvents((prev) => {
      const next = new Map(prev);
      for (const e of list) next.set(e.seq, e);
      return next;
    });
    for (const e of list) {
      lastSeq.current = Math.max(lastSeq.current, e.seq);
      if (TERMINAL.includes(e.type)) terminal.current = true;
    }
    if (list.some((e) => REFRESH_ON.has(e.type))) void refresh();
  }, [refresh]);

  const backfill = useCallback(async () => {
    try {
      merge((await api.events(reviewId, lastSeq.current)).events);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) setError((e as Error).message);
    }
  }, [reviewId, merge]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      try {
        ws = await openReviewSocket(reviewId, (e) => merge([e]), () => {
          setLive(false);
          if (!disposed && !terminal.current) timer = setTimeout(connect, 2000);
        });
        if (disposed) { ws.close(); return; }
        setLive(true);
        // create the review only after the socket is open so no event is missed
        if (pending && !created.current) {
          created.current = true;
          try {
            await api.createReview(reviewId, pending.componentIri, pending.scenario);
          } catch (e) {
            if (!(e instanceof ApiError && e.status === 409)) setError((e as Error).message);
          }
          onCreated();
        }
        await backfill();
        await refresh();
      } catch (e) {
        setError((e as Error).message);
        if (!disposed && !terminal.current) timer = setTimeout(connect, 3000);
      }
    };
    void connect();
    return () => {
      disposed = true;
      clearTimeout(timer);
      ws?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewId]);

  const ordered = useMemo(() => [...events.values()].sort((a, b) => a.seq - b.seq), [events]);
  const r = review?.review;
  const status = r?.status ?? (ordered.length ? '進行中' : '開始待ち');
  const hitl = [...ordered].reverse().find((e) => e.type === 'hitl.required');

  return (
    <div className="detail">
      <section className="card">
        <h1>レビュー <code>{reviewId.slice(0, 8)}</code></h1>
        <dl className="meta">
          <dt>状態</dt><dd><span className={`status status-${status}`}>{status}</span> {live ? <span className="muted">● 接続中</span> : <span className="muted">○ 未接続</span>}</dd>
          <dt>対象</dt><dd>{r ? localName(r.componentIri) : pending ? localName(pending.componentIri) : '—'}</dd>
          <dt>オントロジー</dt><dd>{r?.ontology?.versionInfo ? `v${r.ontology.versionInfo} (sha256 ${r.ontology.sha256?.slice(0, 12)}…)` : '—'}</dd>
          {r?.usage?.totalTokens !== undefined && (
            <><dt>分析</dt><dd>{r.analysisSec}s / {r.usage.totalTokens.toLocaleString()} tokens</dd></>
          )}
          {r?.decision && (<><dt>判断</dt><dd>{r.decision.decision}({r.decision.by}){r.decision.comment && `: ${r.decision.comment}`}</dd></>)}
        </dl>
        {r?.scenario && <p className="scenario">{r.scenario}</p>}
        {error && <p className="error">{error}</p>}
      </section>
      {r?.status === 'WAITING_HITL' && hitl && (
        <HitlPanel reviewId={reviewId} event={hitl} findings={review?.findings.accepted ?? []} onDecided={refresh} />
      )}
      {review && <FindingsTable findings={review.findings} />}
      <EventTimeline events={ordered} />
    </div>
  );
}
