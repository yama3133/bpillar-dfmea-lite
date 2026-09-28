from conftest import NS, good_finding

from dfmea.ontology.validate import validate_finding


def test_accepts_core_path(store):
    assert validate_finding(store, good_finding())["status"] == "accepted"


def test_accepts_cause_root(store):
    r = validate_finding(store, good_finding(cause_path=[NS + "SpotWeldResidualStress"]))
    assert r["code"] == "OK"


def test_accepts_process_root_single(store):
    r = validate_finding(store, good_finding(cause_path=[NS + "SpotWelding", NS + "SpotWeldResidualStress"]))
    assert r["code"] == "OK"


def test_unresolved_iri(store):
    r = validate_finding(store, good_finding(failure_mode_iri=NS + "Nope"))
    assert r == {"status": "rejected", "code": "UNRESOLVED_IRI", "detail": r["detail"]}
    r = validate_finding(store, good_finding(effect_iri=NS + "HAZDelayedFracture"))
    assert r["code"] == "UNRESOLVED_IRI"
    # a Process is only allowed at the root
    r = validate_finding(store, good_finding(cause_path=[NS + "HydrogenAbsorption", NS + "SpotWelding"]))
    assert r["code"] == "UNRESOLVED_IRI"


def test_broken_path_skip(store):
    r = validate_finding(store, good_finding(cause_path=[NS + "Austenitization", NS + "HydrogenEmbrittlement"]))
    assert r["code"] == "BROKEN_CAUSAL_PATH"


def test_broken_path_wrong_effect(store):
    r = validate_finding(store, good_finding(effect_iri=NS + "RoofCrushResistanceLoss"))
    assert r["code"] == "BROKEN_CAUSAL_PATH"


def test_skipped_intermediate_cause(store):
    r = validate_finding(store, good_finding(cause_path=[NS + "HydrogenAbsorption"]))
    assert r["code"] == "BROKEN_CAUSAL_PATH"


def test_empty_path(store):
    assert validate_finding(store, good_finding(cause_path=[]))["code"] == "BROKEN_CAUSAL_PATH"


def test_component_mismatch(store):
    r = validate_finding(store, good_finding(component_iri=NS + "RoofRailJoint"))
    assert r["code"] == "COMPONENT_MISMATCH"
