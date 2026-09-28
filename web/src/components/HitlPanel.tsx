import { useState } from 'react';
import { api } from '../api';
import type { Finding, ReviewEvent } from '../types';
import { localName } from '../types';

interface Props {
  reviewId: string;
  event: ReviewEvent;
  findings: Finding[];
  onDecided: () => void;
}

export default function HitlPanel({ reviewId, event, findings, onDecided }: Props) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const low = (event.data.lowConfidence as { findingId: string; confidence: number }[] | undefined) ?? [];
  const byId = new Map(findings.map((f) => [f.finding_id, f]));

  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(true);
    setError(null);
    try {
      await api.decide(reviewId, decision, comment);
      onDecided();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card hitl">
      <h2>レビュー担当者の判断が必要です</h2>
      <p>信頼度が閾値 {String(event.data.threshold)} 未満の所見があります。</p>
      <ul>
        {low.map((l) => (
          <li key={l.findingId}>
            {l.findingId}: {byId.get(l.findingId) ? localName(byId.get(l.findingId)!.failure_mode_iri) : ''}(信頼度 {l.confidence})
          </li>
        ))}
      </ul>
      <label>コメント<textarea rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button disabled={busy} onClick={() => decide('approve')}>承認</button>
        <button disabled={busy} className="danger" onClick={() => decide('reject')}>却下</button>
      </div>
    </section>
  );
}
