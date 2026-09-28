import type { ReviewEvent } from '../types';

function summary(e: ReviewEvent): string {
  const d = e.data as Record<string, any>;
  switch (e.type) {
    case 'ontology.pinned': return `v${d.versionInfo} / ${String(d.versionId).slice(0, 10)}…`;
    case 'agent.started': return `${d.agent}${d.question ? `: ${String(d.question).slice(0, 120)}` : ''}`;
    case 'agent.finished': return `${d.agent} (${d.elapsedSec}s)`;
    case 'agent.tool_call': return `${d.agent} → ${d.tool}(${Object.values(d.input ?? {}).map((v) => String(v).split('/').pop()).join(', ')})`;
    case 'findings.proposed': return `${d.count}件 / ${d.usage?.totalTokens ?? '?'} tokens`;
    case 'validation.result': return `通過 ${d.acceptedCount} / 却下 ${d.rejectedCount}${d.needsHitl ? ' / 要レビュー' : ''}`;
    case 'hitl.required': return `信頼度 < ${d.threshold} の所見あり`;
    case 'hitl.decided': return `${d.decision} (${d.by})`;
    case 'review.completed': return String(d.status);
    case 'review.failed': return `${d.error}`;
    default: return '';
  }
}

export default function EventTimeline({ events }: { events: ReviewEvent[] }) {
  return (
    <section className="card">
      <h2>イベント</h2>
      {events.length === 0 ? <p className="muted">イベント待ち…</p> : (
        <ol className="timeline">
          {events.map((e) => (
            <li key={e.seq} className={`evt evt-${e.type.replace('.', '-')}`}>
              <span className="seq">#{e.seq}</span>
              <span className="ts">{new Date(e.ts).toLocaleTimeString()}</span>
              <span className="type">{e.type}</span>
              <span className="sum">{summary(e)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
