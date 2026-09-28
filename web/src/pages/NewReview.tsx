import { useEffect, useState } from 'react';
import roofRail from '../../../presets/roof_rail_joint.json';
import seatbelt from '../../../presets/seatbelt_anchor.json';
import { api } from '../api';
import type { PendingReview } from '../App';
import type { ComponentNode } from '../types';

const PRESETS = [seatbelt, roofRail];

export default function NewReview({ onStart }: { onStart: (reviewId: string, req: PendingReview) => void }) {
  const [components, setComponents] = useState<ComponentNode[]>([]);
  const [version, setVersion] = useState('');
  const [componentIri, setComponentIri] = useState('');
  const [scenario, setScenario] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.components()
      .then((r) => {
        setComponents(r.components);
        setVersion(r.versionInfo);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <section className="card">
      <h1>新規レビュー</h1>
      <p className="muted">オントロジー version {version || '…'}</p>
      <div className="presets">
        プリセット:
        {PRESETS.map((p) => (
          <button key={p.name} className="secondary" onClick={() => { setComponentIri(p.componentIri); setScenario(p.scenario); }}>
            {p.name}
          </button>
        ))}
      </div>
      <label>
        対象部品 / インターフェース
        <select value={componentIri} onChange={(e) => setComponentIri(e.target.value)}>
          <option value="">選択してください</option>
          {(['Component', 'Interface'] as const).map((kind) => (
            <optgroup key={kind} label={kind}>
              {components.filter((c) => c.kind === kind).map((c) => (
                <option key={c.iri} value={c.iri}>{c.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label>
        シナリオ
        <textarea rows={6} maxLength={2000} value={scenario} onChange={(e) => setScenario(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <button
        disabled={!componentIri || !scenario.trim()}
        onClick={() => onStart(crypto.randomUUID(), { componentIri, scenario })}
      >
        レビュー開始
      </button>
    </section>
  );
}
