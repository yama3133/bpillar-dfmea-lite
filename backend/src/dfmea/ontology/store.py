"""rdflib-backed ontology store, pinned to a single TTL snapshot."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from rdflib import OWL, RDF, Graph, Namespace, URIRef

DFM = Namespace("https://example.org/bpillar-dfmea/ontology#")
DFMI = Namespace("https://example.org/bpillar-dfmea/id/")


@dataclass
class OntologyStore:
    graph: Graph
    sha256: str
    version_info: str | None
    source: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_bytes(cls, data: bytes, source: dict[str, Any] | None = None) -> "OntologyStore":
        g = Graph()
        g.parse(data=data.decode("utf-8"), format="turtle")
        g.bind("dfm", DFM)
        g.bind("dfmi", DFMI)
        version = None
        for onto in g.subjects(RDF.type, OWL.Ontology):
            v = g.value(onto, OWL.versionInfo)
            if v is not None:
                version = str(v)
                break
        return cls(graph=g, sha256=hashlib.sha256(data).hexdigest(), version_info=version, source=source or {})

    @classmethod
    def from_file(cls, path: str | Path) -> "OntologyStore":
        p = Path(path)
        return cls.from_bytes(p.read_bytes(), source={"path": str(p)})

    @classmethod
    def from_s3(cls, s3_client: Any, bucket: str, key: str, version_id: str | None = None) -> "OntologyStore":
        kwargs: dict[str, Any] = {"Bucket": bucket, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        obj = s3_client.get_object(**kwargs)
        data = obj["Body"].read()
        return cls.from_bytes(
            data, source={"bucket": bucket, "key": key, "versionId": obj.get("VersionId", version_id)}
        )

    def uri(self, iri: str) -> URIRef:
        return URIRef(iri)
