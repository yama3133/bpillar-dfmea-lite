"""Ontology tools bound (by closure) to a single pinned OntologyStore."""

from __future__ import annotations

import json
from typing import Any

from strands import tool

from ..ontology import queries as q
from ..ontology.store import OntologyStore


def _j(x: Any) -> str:
    return json.dumps(x, ensure_ascii=False)


def make_ontology_tools(store: OntologyStore) -> dict[str, list[Any]]:
    @tool
    def list_failure_modes() -> str:
        """List all failure modes in the ontology with their IRI, label and occursAt locations."""
        return _j(q.list_failure_modes(store))

    @tool
    def get_causal_chain(failure_mode_iri: str) -> str:
        """Return upstream cause paths (root -> immediate cause), effects, occursAt, detection and prevention controls.

        Args:
            failure_mode_iri: Full IRI of a failure mode, exactly as returned by list_failure_modes.
        """
        return _j(q.get_causal_chain(store, failure_mode_iri))

    @tool
    def check_causal_path(iris: list[str]) -> str:
        """Check that every adjacent pair of IRIs is linked by a direct causes edge (first edge may be induces).

        Args:
            iris: Ordered IRIs, e.g. cause_path + [failure_mode_iri, effect_iri].
        """
        return _j(q.check_causal_path(store, iris))

    @tool
    def list_components() -> str:
        """List all components and interfaces (IRI, label, kind)."""
        return _j(q.list_components(store))

    @tool
    def get_interfaces(component_iri: str) -> str:
        """Return interfaces joining a component (or the interface itself with the components it joins).

        Args:
            component_iri: Full IRI exactly as returned by list_components.
        """
        return _j(q.get_interfaces(store, component_iri))

    @tool
    def get_processes(component_iri: str) -> str:
        """Return processes that form the component / join the interface, with the causes they induce.

        Args:
            component_iri: Full IRI exactly as returned by list_components.
        """
        return _j(q.get_processes(store, component_iri))

    return {
        "failure_mode": [list_failure_modes, get_causal_chain, check_causal_path],
        "structure": [list_components, get_interfaces, get_processes],
    }
