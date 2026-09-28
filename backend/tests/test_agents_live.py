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
