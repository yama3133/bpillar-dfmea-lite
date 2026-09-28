"""Read-only graph queries used by agent tools, API and validation."""

from __future__ import annotations

from typing import Any

from rdflib import RDF, RDFS, Literal, URIRef
from rdflib.term import Node

from ..i18n import RDF_LANG_TAG
from .store import DFM, OntologyStore


def label_for(store: OntologyStore, iri: URIRef | Node, lang: str = "en") -> str:
    """rdfs:label in `lang` (API code, e.g. zh-CN), else @en, else an untagged label, else the IRI tail."""
    labels = [o for o in store.graph.objects(iri, RDFS.label) if isinstance(o, Literal)]
    by_tag: dict[str, str] = {}
    for o in sorted(labels, key=str):
        by_tag.setdefault((o.language or "").lower(), str(o))
    for tag in (RDF_LANG_TAG.get(lang, lang).lower(), "en", ""):
        if by_tag.get(tag):
            return by_tag[tag]
    s = str(iri)
    return s[max(s.rfind("/"), s.rfind("#")) + 1:]


def _node(store: OntologyStore, iri: URIRef | Node, lang: str = "en") -> dict[str, Any]:
    g = store.graph
    return {
        "iri": str(iri),
        "label": label_for(store, iri, lang),
        "comment": str(g.value(iri, RDFS.comment) or ""),
    }


def _sorted(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(nodes, key=lambda n: n["iri"])


def is_instance_of(store: OntologyStore, iri: str, cls: URIRef) -> bool:
    """rdf:type / rdfs:subClassOf* check."""
    g = store.graph
    for t in g.objects(URIRef(iri), RDF.type):
        if t == cls or cls in set(g.transitive_objects(t, RDFS.subClassOf)):
            return True
    return False


def instances(store: OntologyStore, cls: URIRef, lang: str = "en") -> list[dict[str, Any]]:
    g = store.graph
    subs = set(g.transitive_subjects(RDFS.subClassOf, cls))
    out = {s for c in subs for s in g.subjects(RDF.type, c)}
    return _sorted([_node(store, s, lang) for s in out])


def list_components(store: OntologyStore, lang: str = "en") -> list[dict[str, Any]]:
    """Components and interfaces (both are valid review targets). Agent tools use the default (English) labels."""
    comps = [dict(n, kind="Component") for n in instances(store, DFM.Component, lang)]
    ifs = [dict(n, kind="Interface") for n in instances(store, DFM.Interface, lang)]
    return comps + ifs


def get_interfaces(store: OntologyStore, component_iri: str) -> list[dict[str, Any]]:
    g = store.graph
    c = URIRef(component_iri)
    if is_instance_of(store, component_iri, DFM.Interface):
        return [
            dict(_node(store, c), joins=[_node(store, x) for x in g.objects(c, DFM.joins)],
                 joinedBy=[_node(store, p) for p in g.objects(c, DFM.joinedBy)])
        ]
    out = []
    for i in g.subjects(DFM.joins, c):
        out.append(
            dict(_node(store, i), joins=[_node(store, x) for x in g.objects(i, DFM.joins)],
                 joinedBy=[_node(store, p) for p in g.objects(i, DFM.joinedBy)])
        )
    return _sorted(out)


def get_processes(store: OntologyStore, component_iri: str) -> list[dict[str, Any]]:
    """Processes that form the component, or join the interface."""
    g = store.graph
    c = URIRef(component_iri)
    procs = set(g.objects(c, DFM.formedBy)) | set(g.objects(c, DFM.joinedBy))
    out = []
    for p in procs:
        out.append(dict(_node(store, p), induces=[_node(store, x) for x in g.objects(p, DFM.induces)]))
    return _sorted(out)


def list_failure_modes(store: OntologyStore) -> list[dict[str, Any]]:
    g = store.graph
    out = []
    for fm in instances(store, DFM.FailureMode):
        u = URIRef(fm["iri"])
        fm["occursAt"] = [str(x) for x in g.objects(u, DFM.occursAt)]
        out.append(fm)
    return out


def _upstream_paths(store: OntologyStore, target: URIRef, max_depth: int = 8) -> list[list[str]]:
    """All root->target paths following causes backwards, ending at a Process via induces when possible."""
    g = store.graph
    paths: list[list[str]] = []

    def walk(node: URIRef, suffix: list[str], depth: int) -> None:
        parents = [p for p in g.subjects(DFM.causes, node) if isinstance(p, URIRef)]
        inducers = [p for p in g.subjects(DFM.induces, node) if isinstance(p, URIRef)]
        if depth >= max_depth or (not parents and not inducers):
            paths.append(suffix)
            return
        for p in inducers:
            paths.append([str(p)] + suffix)
        for p in parents:
            if str(p) in suffix:
                continue
            walk(p, [str(p)] + suffix, depth + 1)

    walk(target, [], 0)
    return sorted(p for p in paths if p)


def get_causal_chain(store: OntologyStore, failure_mode_iri: str) -> dict[str, Any]:
    g = store.graph
    fm = URIRef(failure_mode_iri)
    if not is_instance_of(store, failure_mode_iri, DFM.FailureMode):
        return {"error": f"not a FailureMode: {failure_mode_iri}"}
    effects = []
    for e in g.objects(fm, DFM.causes):
        sev = g.value(e, DFM.defaultSeverity)
        effects.append(dict(_node(store, e), defaultSeverity=int(sev) if sev is not None else None))
    return {
        "failureMode": _node(store, fm),
        "occursAt": [_node(store, x) for x in g.objects(fm, DFM.occursAt)],
        "causePaths": _upstream_paths(store, fm),
        "effects": _sorted(effects),
        "detectedBy": _sorted([_node(store, x) for x in g.objects(fm, DFM.detectedBy)]),
        "preventedBy": _sorted([_node(store, x) for x in g.objects(fm, DFM.preventedBy)]),
    }


def edge_ok(store: OntologyStore, a: str, b: str, *, first: bool) -> bool:
    """A direct dfm:causes edge, or (first edge only, from a Process) a dfm:induces edge."""
    g = store.graph
    ua, ub = URIRef(a), URIRef(b)
    if (ua, DFM.causes, ub) in g:
        return True
    return first and is_instance_of(store, a, DFM.Process) and (ua, DFM.induces, ub) in g


def check_causal_path(store: OntologyStore, iris: list[str]) -> dict[str, Any]:
    broken = []
    for i in range(len(iris) - 1):
        if not edge_ok(store, iris[i], iris[i + 1], first=(i == 0)):
            broken.append({"from": iris[i], "to": iris[i + 1]})
    return {"valid": not broken and len(iris) >= 2, "brokenEdges": broken}
