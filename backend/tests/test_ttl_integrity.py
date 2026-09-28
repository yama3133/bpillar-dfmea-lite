import pytest
from conftest import TTL_V1, TTL_V2
from rdflib import OWL, RDF, RDFS, URIRef

from dfmea.ontology.store import DFM, DFMI, OntologyStore

CLASSES = {DFM.Component, DFM.Interface, DFM.Material, DFM.Process, DFM.Cause, DFM.FailureMode,
           DFM.Effect, DFM.DetectionControl, DFM.PreventionControl}


@pytest.fixture(params=[TTL_V1, TTL_V2], ids=["v1", "v2"])
def s(request):
    return OntologyStore.from_file(request.param)


def test_individual_count(s):
    n = len({x for x in s.graph.subjects(RDF.type, None) if str(x).startswith(str(DFMI))})
    assert 30 <= n <= 50


def test_all_used_iris_are_typed(s):
    g = s.graph
    used = set()
    for sub, _, obj in g:
        for t in (sub, obj):
            if isinstance(t, URIRef) and (str(t).startswith(str(DFMI)) or str(t).startswith(str(DFM))):
                used.add(t)
    untyped = [u for u in used if (u, RDF.type, None) not in g]
    assert not untyped


def test_all_nodes_have_label_and_comment(s):
    g = s.graph
    for x in {x for x in g.subjects(RDF.type, None) if isinstance(x, URIRef)}:
        assert g.value(x, RDFS.label) is not None, x
        assert g.value(x, RDFS.comment) is not None, x


def test_every_failure_mode_reachable_from_process_and_has_effect(s):
    g = s.graph
    reachable = set()
    frontier = [c for p in g.subjects(RDF.type, DFM.Process) for c in g.objects(p, DFM.induces)]
    while frontier:
        n = frontier.pop()
        if n in reachable:
            continue
        reachable.add(n)
        frontier.extend(g.objects(n, DFM.causes))
    for fm in g.subjects(RDF.type, DFM.FailureMode):
        assert fm in reachable, fm
        effects = [e for e in g.objects(fm, DFM.causes) if (e, RDF.type, DFM.Effect) in g]
        assert effects, fm
        assert list(g.objects(fm, DFM.occursAt)), fm


def test_classes_declared(s):
    for c in CLASSES:
        assert (c, RDF.type, OWL.Class) in s.graph


LABEL_TAGS = {"en", "ja", "ar", "zh-hans"}


def test_all_nodes_have_labels_in_four_languages(s):
    g = s.graph
    for x in {x for x in g.subjects(RDF.type, None) if isinstance(x, URIRef)}:
        tags = [(o.language or "").lower() for o in g.objects(x, RDFS.label)]
        assert sorted(tags) == sorted(LABEL_TAGS), (x, tags)
        assert all(str(o).strip() for o in g.objects(x, RDFS.label)), x
