import { intlLocale, isLang, isoAuto, isoLtr as L, lookup, useI18n, type Lang, type Messages } from '../i18n';
import type { ReviewEvent } from '../types';

interface Summary {
  text: string;
  /** code-like summaries (tool calls) read left-to-right in every language */
  ltr?: boolean;
}

function summary(e: ReviewEvent, t: Messages, lang: Lang): Summary {
  const d = e.data as Record<string, any>;
  const num = (n: unknown) => (typeof n === 'number' ? n.toLocaleString(intlLocale(lang)) : String(n ?? '?'));
  switch (e.type) {
    case 'review.accepted': return { text: t.evt.accepted(isLang(d.language) ? t.langNames[d.language] : undefined) };
    case 'ontology.pinned': return { text: `${t.evt.pinned(String(d.versionInfo))} (${L(`${String(d.versionId).slice(0, 10)}…`)})` };
    case 'agent.started': return { text: `${t.evt.agentStarted(L(d.agent))}${d.question ? `: ${isoAuto(String(d.question).slice(0, 120))}` : ''}` };
    case 'agent.finished': return { text: t.evt.agentFinished(L(d.agent), String(d.elapsedSec)) };
    case 'agent.tool_call': return {
      text: `${d.agent} → ${d.tool}(${Object.values(d.input ?? {}).map((v) => String(v).split('/').pop()).join(', ')})`,
      ltr: true,
    };
    case 'findings.proposed': return { text: t.evt.proposed(Number(d.count), num(d.usage?.totalTokens)) };
    case 'validation.result': return { text: t.evt.validation(Number(d.acceptedCount), Number(d.rejectedCount), Boolean(d.needsHitl)) };
    case 'hitl.required': return { text: t.evt.hitlRequired(String(d.threshold)) };
    case 'hitl.decided': return { text: t.evt.hitlDecided(lookup(t.decisions, String(d.decision)), L(d.by)) };
    case 'review.completed': return { text: t.evt.completed(lookup(t.statuses, String(d.status))) };
    case 'review.failed': return { text: t.evt.failed(L(d.error)) };
    default: return { text: '' };
  }
}

export default function EventTimeline({ events }: { events: ReviewEvent[] }) {
  const { lang, t } = useI18n();
  return (
    <section className="card">
      <h2>{t.eventsTitle}</h2>
      {events.length === 0 ? <p className="muted">{t.waitingEvents}</p> : (
        <ol className="timeline">
          {events.map((e) => {
            const s = summary(e, t, lang);
            return (
              <li key={e.seq} className={`evt evt-${e.type.replace('.', '-')}`}>
                <span className="seq"><bdi dir="ltr">#{e.seq}</bdi></span>
                <span className="ts"><bdi dir="ltr">{new Date(e.ts).toLocaleTimeString(intlLocale(lang))}</bdi></span>
                <span className="type"><bdi dir="ltr">{e.type}</bdi></span>
                <span className="sum" dir={s.ltr ? 'ltr' : undefined}>{s.text}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
