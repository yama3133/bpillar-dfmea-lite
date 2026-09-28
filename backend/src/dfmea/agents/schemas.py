"""Structured output schemas for the analyst agent."""

from __future__ import annotations

from pydantic import BaseModel, Field


class Finding(BaseModel):
    finding_id: str = Field(description="Short unique id, e.g. F1, F2")
    component_iri: str = Field(description="IRI of the Component/Interface where the failure mode occurs (occursAt)")
    failure_mode_iri: str
    cause_path: list[str] = Field(description="Causal chain IRIs ordered root -> immediate cause of the failure mode")
    effect_iri: str
    severity: int = Field(ge=1, le=10)
    occurrence: int = Field(ge=1, le=10)
    detection: int = Field(ge=1, le=10)
    confidence: float = Field(ge=0.0, le=1.0)
    rationale: str = Field(description="Written in the requested output language")
    recommended_actions: list[str] = Field(description="Each item written in the requested output language")


class ReviewFindings(BaseModel):
    findings: list[Finding]
