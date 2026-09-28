from conftest import NS, TTL_V1, TTL_V2

from dfmea.ontology import queries as q
from dfmea.ontology.store import OntologyStore


def test_version_and_hash(store):
    assert store.version_info == "1.0.0"
    assert len(store.sha256) == 64
    v2 = OntologyStore.from_file(TTL_V2)
    assert v2.version_info == "1.1.0"
    assert v2.sha256 != store.sha256


def test_list_components_includes_interfaces(store):
    iris = {c["iri"] for c in q.list_components(store)}
    assert NS + "BPillarOuter" in iris and NS + "SeatbeltAnchorMount" in iris
    assert len(iris) == 7


def test_interfaces_and_processes(store):
    ifs = q.get_interfaces(store, NS + "BPillarInner")
    assert NS + "SeatbeltAnchorMount" in {i["iri"] for i in ifs}
    procs = q.get_processes(store, NS + "SeatbeltAnchorMount")
    assert [p["iri"] for p in procs] == [NS + "SpotWelding"]


def test_causal_chain_core_path(store):
    chain = q.get_causal_chain(store, NS + "HAZDelayedFracture")
    assert [NS + "Austenitization", NS + "HydrogenAbsorption", NS + "HydrogenEmbrittlement"] in chain["causePaths"]
    assert [NS + "SpotWelding", NS + "SpotWeldResidualStress"] in chain["causePaths"]
    assert chain["effects"][0]["defaultSeverity"] == 10
    assert chain["occursAt"][0]["iri"] == NS + "SeatbeltAnchorMount"


def test_check_causal_path(store):
    ok = q.check_causal_path(store, [NS + "Austenitization", NS + "HydrogenAbsorption", NS + "HydrogenEmbrittlement"])
    assert ok["valid"]
    bad = q.check_causal_path(store, [NS + "Austenitization", NS + "HydrogenEmbrittlement"])
    assert not bad["valid"]


def test_v2_diff():
    v1 = OntologyStore.from_file(TTL_V1)
    v2 = OntologyStore.from_file(TTL_V2)
    c1 = q.get_causal_chain(v1, NS + "HAZDelayedFracture")["detectedBy"]
    c2 = q.get_causal_chain(v2, NS + "HAZDelayedFracture")["detectedBy"]
    assert c1[0]["iri"] == NS + "DelayedFractureTest"
    assert c2[0]["iri"] == NS + "ThermalDesorptionAnalysis"
