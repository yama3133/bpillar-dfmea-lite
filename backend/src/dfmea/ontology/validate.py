"""Deterministic validation of agent findings against the pinned ontology."""

from __future__ import annotations

from typing import Any

from rdflib import URIRef

from .queries import edge_ok, is_instance_of
from .store import DFM, OntologyStore

OK = "OK"
UNRESOLVED_IRI = "UNRESOLVED_IRI"
BROKEN_CAUSAL_PATH = "BROKEN_CAUSAL_PATH"
COMPONENT_MISMATCH = "COMPONENT_MISMATCH"


def _result(status: str, code: str, detail: str) -> dict[str, str]:
    return {"status": status, "code": code, "detail": detail}


def validate_finding(store: OntologyStore, f: dict[str, Any]) -> dict[str, str]:
    """Returns {status: accepted|rejected, code, detail}.

    Chain checked: cause_path + [failure_mode, effect]. Every adjacent pair needs a direct
    dfm:causes edge; only the very first edge may be dfm:induces, and only when the root is a Process.
    """
    cause_path: list[str] = list(f.get("cause_path") or [])
    fm = f.get("failure_mode_iri", "")
    effect = f.get("effect_iri", "")
    comp = f.get("component_iri", "")

    if not is_instance_of(store, comp, DFM.Component) and not is_instance_of(store, comp, DFM.Interface):
        return _result("rejected", UNRESOLVED_IRI, f"component_iri is not a Component/Interface: {comp}")
    if not is_instance_of(store, fm, DFM.FailureMode):
        return _result("rejected", UNRESOLVED_IRI, f"failure_mode_iri is not a FailureMode: {fm}")
    if not is_instance_of(store, effect, DFM.Effect):
        return _result("rejected", UNRESOLVED_IRI, f"effect_iri is not an Effect: {effect}")
    if not cause_path:
        return _result("rejected", BROKEN_CAUSAL_PATH, "cause_path is empty")
    for i, iri in enumerate(cause_path):
        ok = is_instance_of(store, iri, DFM.Cause) or (i == 0 and is_instance_of(store, iri, DFM.Process))
        if not ok:
            expected = "Process/Cause" if i == 0 else "Cause"
            return _result("rejected", UNRESOLVED_IRI, f"cause_path[{i}] is not a {expected}: {iri}")

    chain = cause_path + [fm, effect]
    for i in range(len(chain) - 1):
        if not edge_ok(store, chain[i], chain[i + 1], first=(i == 0)):
            return _result("rejected", BROKEN_CAUSAL_PATH, f"no direct edge {chain[i]} -> {chain[i + 1]}")

    if (URIRef(fm), DFM.occursAt, URIRef(comp)) not in store.graph:
        return _result("rejected", COMPONENT_MISMATCH, f"{fm} does not occurAt {comp}")
    return _result("accepted", OK, "all checks passed")


def validate_findings(store: OntologyStore, findings: list[dict[str, Any]]) -> list[dict[str, str]]:
    return [validate_finding(store, f) for f in findings]
