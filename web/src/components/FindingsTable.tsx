import { lookup, useI18n } from '../i18n';
import type { Finding, ReviewResponse } from '../types';
import { localName } from '../types';

function Row({ f, rejected }: { f: Finding; rejected?: boolean }) {
  const { t } = useI18n();
  return (
    <tr>
      <td><bdi dir="ltr">{f.finding_id}</bdi></td>
      <td><bdi dir="ltr">{localName(f.failure_mode_iri)}</bdi><div className="muted small"><bdi dir="ltr">@ {localName(f.component_iri)}</bdi></div></td>
      <td className="path"><bdi dir="ltr">{f.cause_path.map(localName).join(' → ')}</bdi></td>
      <td><bdi dir="ltr">{localName(f.effect_iri)}</bdi></td>
      <td className="num">{f.severity}</td>
      <td className="num">{f.occurrence}</td>
      <td className="num">{f.detection}</td>
      <td className="num strong">{f.rpn}</td>
      <td className="num">{f.confidence.toFixed(2)}</td>
      <td>
        {f.validation
          ? <span className={rejected ? 'badge bad' : 'badge ok'} title={lookup(t.validationCodes, f.validation.code)}><bdi dir="ltr">{f.validation.code}</bdi></span>
          : <span className="muted">{t.notValidated}</span>}
        {rejected && f.validation && (
          <div className="muted small">
            {lookup(t.validationCodes, f.validation.code)}
            <div><bdi dir="ltr">{f.validation.detail}</bdi></div>
          </div>
        )}
      </td>
    </tr>
  );
}

function Table({ rows, rejected }: { rows: Finding[]; rejected?: boolean }) {
  const { t } = useI18n();
  return (
    <table>
      <thead>
        <tr>
          <th>ID</th><th>{t.col.failureMode}</th><th>{t.col.causePath}</th><th>{t.col.effect}</th>
          <th title={t.col.severity}>S</th><th title={t.col.occurrence}>O</th><th title={t.col.detection}>D</th>
          <th title={t.col.rpn}>RPN</th><th>{t.col.confidence}</th><th>{t.col.validation}</th>
        </tr>
      </thead>
      <tbody>{rows.map((f) => <Row key={f.finding_id} f={f} rejected={rejected} />)}</tbody>
    </table>
  );
}

/** `outputLang` is the language the AI wrote rationale/actions in (fixed at review creation). */
export default function FindingsTable({ findings, outputLang }: { findings: ReviewResponse['findings']; outputLang?: string }) {
  const { t } = useI18n();
  const accepted = [...findings.accepted].sort((a, b) => b.rpn - a.rpn);
  const pending = findings.pending;
  if (!accepted.length && !findings.rejected.length && !pending.length) return null;
  return (
    <section className="card">
      <h2>{t.findingsTitle}</h2>
      {accepted.length ? <Table rows={accepted} /> : <p className="muted">{t.noAccepted}</p>}
      {pending.length > 0 && (<><h3>{t.pendingValidation}</h3><Table rows={pending} /></>)}
      {findings.rejected.length > 0 && (
        <details open>
          <summary>{t.rejectedSummary(findings.rejected.length)}</summary>
          <Table rows={findings.rejected} rejected />
        </details>
      )}
      {accepted.map((f) => (
        <details key={f.finding_id} className="rationale">
          <summary>{t.rationaleSummary(f.finding_id)}</summary>
          <div lang={outputLang} dir="auto">
            <p dir="auto">{f.rationale}</p>
            <ul>{f.recommended_actions.map((a, i) => <li key={i} dir="auto">{a}</li>)}</ul>
          </div>
        </details>
      ))}
    </section>
  );
}
