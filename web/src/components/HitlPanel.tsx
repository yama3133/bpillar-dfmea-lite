import { useState } from 'react';
import { api } from '../api';
import { errorText } from '../errors';
import { useI18n } from '../i18n';
import type { Finding, ReviewEvent } from '../types';
import { localName } from '../types';

interface Props {
  reviewId: string;
  event: ReviewEvent;
  findings: Finding[];
  onDecided: () => void;
}

export default function HitlPanel({ reviewId, event, findings, onDecided }: Props) {
  const { t } = useI18n();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const low = (event.data.lowConfidence as { findingId: string; confidence: number }[] | undefined) ?? [];
  const byId = new Map(findings.map((f) => [f.finding_id, f]));

  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(true);
    setError(null);
    try {
      await api.decide(reviewId, decision, comment);
      onDecided();
    } catch (e) {
      setError(e ?? 'unknown');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card hitl">
      <h2>{t.hitlTitle}</h2>
      <p>{t.hitlBody(String(event.data.threshold))}</p>
      <ul>
        {low.map((l) => (
          <li key={l.findingId}>
            <bdi dir="ltr">{l.findingId}: {byId.get(l.findingId) ? localName(byId.get(l.findingId)!.failure_mode_iri) : ''}</bdi> ({t.confidenceValue(String(l.confidence))})
          </li>
        ))}
      </ul>
      <label>{t.comment}<textarea rows={3} maxLength={1000} dir="auto" value={comment} onChange={(e) => setComment(e.target.value)} /></label>
      {error !== null && <p className="error">{errorText(t, error)}</p>}
      <div className="actions">
        <button disabled={busy} onClick={() => decide('approve')}>{t.approve}</button>
        <button disabled={busy} className="danger" onClick={() => decide('reject')}>{t.reject}</button>
      </div>
    </section>
  );
}
