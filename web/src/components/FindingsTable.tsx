import type { Finding, ReviewResponse } from '../types';
import { localName } from '../types';

function Row({ f, rejected }: { f: Finding; rejected?: boolean }) {
  return (
    <tr>
      <td>{f.finding_id}</td>
      <td>{localName(f.failure_mode_iri)}<div className="muted small">@ {localName(f.component_iri)}</div></td>
      <td className="path">{f.cause_path.map(localName).join(' → ')}</td>
      <td>{localName(f.effect_iri)}</td>
      <td className="num">{f.severity}</td>
      <td className="num">{f.occurrence}</td>
      <td className="num">{f.detection}</td>
      <td className="num strong">{f.rpn}</td>
      <td className="num">{f.confidence.toFixed(2)}</td>
      <td>
        {f.validation ? <span className={rejected ? 'badge bad' : 'badge ok'}>{f.validation.code}</span> : <span className="muted">未検証</span>}
        {rejected && f.validation && <div className="muted small">{f.validation.detail}</div>}
      </td>
    </tr>
  );
}

function Table({ rows, rejected }: { rows: Finding[]; rejected?: boolean }) {
  return (
    <table>
      <thead>
        <tr><th>ID</th><th>故障モード</th><th>原因パス</th><th>影響</th><th>S</th><th>O</th><th>D</th><th>RPN</th><th>信頼度</th><th>検証</th></tr>
      </thead>
      <tbody>{rows.map((f) => <Row key={f.finding_id} f={f} rejected={rejected} />)}</tbody>
    </table>
  );
}

export default function FindingsTable({ findings }: { findings: ReviewResponse['findings'] }) {
  const accepted = [...findings.accepted].sort((a, b) => b.rpn - a.rpn);
  const pending = findings.pending;
  if (!accepted.length && !findings.rejected.length && !pending.length) return null;
  return (
    <section className="card">
      <h2>所見(RPN降順)</h2>
      {accepted.length ? <Table rows={accepted} /> : <p className="muted">検証を通過した所見はありません。</p>}
      {pending.length > 0 && (<><h3>検証待ち</h3><Table rows={pending} /></>)}
      {findings.rejected.length > 0 && (
        <details open>
          <summary>検証で却下された所見({findings.rejected.length}件)</summary>
          <Table rows={findings.rejected} rejected />
        </details>
      )}
      {accepted.map((f) => (
        <details key={f.finding_id} className="rationale">
          <summary>{f.finding_id} の根拠と推奨対策</summary>
          <p>{f.rationale}</p>
          <ul>{f.recommended_actions.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </details>
      ))}
    </section>
  );
}
