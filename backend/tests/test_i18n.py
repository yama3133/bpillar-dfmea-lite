import pytest
from conftest import NS

from dfmea import i18n
from dfmea.agents import orchestrator
from dfmea.ontology import queries as q
from dfmea.ontology.store import OntologyStore

MINI = b"""
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix dfm:  <https://example.org/bpillar-dfmea/ontology#> .
@prefix dfmi: <https://example.org/bpillar-dfmea/id/> .
dfmi:Both a dfm:Component ; rdfs:label "Both"@en , "Beide"@ja .
dfmi:EnOnly a dfm:Component ; rdfs:label "English only"@en , "Untagged"  .
dfmi:Untagged a dfm:Component ; rdfs:label "Plain" .
dfmi:NoLabel a dfm:Component .
"""


def test_label_fallback_order():
    s = OntologyStore.from_bytes(MINI)
    assert q.label_for(s, s.uri(NS + "Both"), "ja") == "Beide"
    assert q.label_for(s, s.uri(NS + "Both"), "ar") == "Both"          # -> en
    assert q.label_for(s, s.uri(NS + "EnOnly"), "zh-CN") == "English only"
    assert q.label_for(s, s.uri(NS + "Untagged"), "ar") == "Plain"     # -> untagged
    assert q.label_for(s, s.uri(NS + "NoLabel"), "ja") == "NoLabel"    # -> IRI tail


@pytest.mark.parametrize("lang,expected", [
    ("ja", "シートベルトアンカー取付部"), ("en", "Seatbelt anchor mount"),
    ("ar", "نقطة تثبيت مرساة حزام الأمان"), ("zh-CN", "安全带锚点安装座"),
])
def test_component_labels_per_language(store, lang, expected):
    by_iri = {c["iri"]: c["label"] for c in q.list_components(store, lang)}
    assert by_iri[NS + "SeatbeltAnchorMount"] == expected


def test_agent_tools_default_to_english(store):
    assert {c["label"] for c in q.list_components(store)} >= {"Seatbelt anchor mount", "B-pillar outer"}
    assert q.get_causal_chain(store, NS + "HAZDelayedFracture")["failureMode"]["label"] == "HAZ delayed fracture"


@pytest.mark.parametrize("lang", i18n.LANGUAGES)
def test_prompts_carry_language_rule(lang):
    name = i18n.PROMPT_LANGUAGE_NAME[lang]
    analyst = orchestrator.ANALYST_PROMPT.format(language_rule=orchestrator.language_rule(lang, analyst=True))
    assert f"`recommended_actions` in {name}" in analyst and "{" not in analyst
    for p in (orchestrator.FAILURE_MODE_PROMPT, orchestrator.STRUCTURE_PROMPT):
        text = p.format(language_rule=orchestrator.language_rule(lang, analyst=False))
        assert name in text and "{" not in text


def test_run_analysis_rejects_unknown_language(store):
    with pytest.raises(ValueError):
        orchestrator.run_analysis(store, NS + "SeatbeltAnchorMount", "x", lambda t, d: None, language="fr")


@pytest.mark.parametrize("stored,expected", [("ar", "ar"), (None, "ja")])
def test_analyze_passes_review_language(aws_mock, monkeypatch, stored, expected):
    from conftest import put_meta

    from dfmea.agents.schemas import ReviewFindings
    from dfmea.handlers import analyze, workflow

    rid = "44444444-4444-4444-8444-444444444444"
    put_meta(rid, **({"language": stored} if stored else {}))
    workflow.pin(rid)
    seen = {}

    def fake(store, comp, scenario, emit, language):
        seen["language"] = language
        return orchestrator.AnalysisResult(findings=ReviewFindings(findings=[]), usage={}, elapsed_sec=0.0)

    monkeypatch.setattr(analyze, "run_analysis", fake)
    analyze.handler({"reviewId": rid})
    assert seen["language"] == expected
