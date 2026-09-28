import { useEffect, useState } from 'react';
import roofRail from '../../../presets/roof_rail_joint.json';
import seatbelt from '../../../presets/seatbelt_anchor.json';
import { api } from '../api';
import type { PendingReview } from '../App';
import { errorText } from '../errors';
import { useI18n } from '../i18n';
import type { ComponentNode } from '../types';

const PRESETS = [seatbelt, roofRail];

export default function NewReview({ onStart }: { onStart: (reviewId: string, req: PendingReview) => void }) {
  const { lang, t } = useI18n();
  const [components, setComponents] = useState<ComponentNode[]>([]);
  const [version, setVersion] = useState('');
  const [componentIri, setComponentIri] = useState('');
  const [scenario, setScenario] = useState('');
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let stale = false;
    api.components(lang)
      .then((r) => {
        if (stale) return;
        setComponents(r.components);
        setVersion(r.versionInfo);
        setError(null);
      })
      .catch((e: unknown) => { if (!stale) setError(e ?? 'unknown'); });
    return () => { stale = true; };
  }, [lang]);

  // preset names come from the (English) preset files; show the ontology label in the UI language instead
  const presetLabel = (p: (typeof PRESETS)[number]) => components.find((c) => c.iri === p.componentIri)?.label ?? p.name;

  return (
    <section className="card">
      <h1>{t.newReviewTitle}</h1>
      <p className="muted">{t.ontologyVersion} <bdi dir="ltr">{version || '…'}</bdi></p>
      <div className="presets">
        {t.presets}
        {PRESETS.map((p) => (
          <button key={p.name} className="secondary" onClick={() => { setComponentIri(p.componentIri); setScenario(p.scenario); }}>
            {presetLabel(p)}
          </button>
        ))}
      </div>
      <label>
        {t.target}
        <select value={componentIri} onChange={(e) => setComponentIri(e.target.value)}>
          <option value="">{t.selectPlaceholder}</option>
          {(['Component', 'Interface'] as const).map((kind) => (
            <optgroup key={kind} label={t.kind[kind]}>
              {components.filter((c) => c.kind === kind).map((c) => (
                <option key={c.iri} value={c.iri}>{c.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label>
        {t.scenario}
        <textarea rows={6} maxLength={2000} dir="auto" value={scenario} onChange={(e) => setScenario(e.target.value)} />
      </label>
      <p className="muted small">{t.outputLanguageHint(t.langNames[lang])}</p>
      {error !== null && <p className="error">{errorText(t, error)}</p>}
      <button
        disabled={!componentIri || !scenario.trim()}
        onClick={() => onStart(crypto.randomUUID(), { componentIri, scenario, language: lang })}
      >
        {t.startReview}
      </button>
    </section>
  );
}
