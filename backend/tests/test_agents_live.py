import json

import pytest
from conftest import PRESETS

from dfmea.ontology.validate import validate_findings


@pytest.mark.live
def test_live_roof_rail_joint(store):
    from dfmea.agents.orchestrator import run_analysis

    preset = json.loads((PRESETS / "roof_rail_joint.json").read_text())
    events = []
    res = run_analysis(store, preset["componentIri"], preset["scenario"], lambda t, d: events.append(t))
    findings = [f.model_dump() for f in res.findings.findings]
    assert findings
    vals = validate_findings(store, findings)
    assert any(v["status"] == "accepted" for v in vals)
    assert "agent.tool_call" in events
    assert events.count("agent.started") == events.count("agent.finished")
    assert res.usage["totalTokens"] > 0
    print(json.dumps({"n": len(findings), "codes": [v["code"] for v in vals],
                      "elapsed": res.elapsed_sec, "tokens": res.usage["totalTokens"]}))


def _script_ratio(text: str, lo: int, hi: int) -> float:
    letters = [c for c in text if c.isalpha()]
    return sum(lo <= ord(c) <= hi for c in letters) / max(1, len(letters))


@pytest.mark.live
@pytest.mark.parametrize("language", ["en", "ar"])
def test_live_output_language(store, language):
    from dfmea.agents.orchestrator import run_analysis

    preset = json.loads((PRESETS / "seatbelt_anchor.json").read_text())
    res = run_analysis(store, preset["componentIri"], preset["scenario"], lambda t, d: None, language=language)
    findings = [f.model_dump() for f in res.findings.findings]
    assert findings
    text = " ".join(f["rationale"] + " " + " ".join(f["recommended_actions"]) for f in findings)
    if language == "ar":
        assert _script_ratio(text, 0x0600, 0x06FF) > 0.5
    else:
        assert _script_ratio(text, 0x0041, 0x007A) > 0.9
    for f in findings:  # IRIs stay verbatim
        assert f["failure_mode_iri"].startswith("https://example.org/bpillar-dfmea/id/")
    print(json.dumps({"language": language, "rationale": findings[0]["rationale"][:200],
                      "action": findings[0]["recommended_actions"][:1]}, ensure_ascii=False))
