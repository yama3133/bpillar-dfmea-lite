"""Analyst agent (Sonnet) that uses two specialist agents (Haiku) as tools."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from strands import Agent, tool
from strands.hooks import BeforeToolCallEvent, HookProvider, HookRegistry
from strands.models import BedrockModel

from .. import config
from ..ontology.store import OntologyStore
from .schemas import ReviewFindings
from .tools import make_ontology_tools

Emit = Callable[[str, dict[str, Any]], None]

MAX_SPECIALIST_CALLS = 2

IRI_RULE = (
    "IRIs must be copied verbatim from tool return values. Never invent, shorten or re-case an IRI."
)

FAILURE_MODE_PROMPT = f"""You are a DFMEA failure-mode specialist for a hot-stamped automotive B-pillar.
Use the ontology tools to answer the question. Report failure modes, their occursAt locations,
complete cause paths (root -> immediate cause), effects with defaultSeverity, and detection/prevention controls.
When you propose a chain, verify it with check_causal_path before reporting it.
{IRI_RULE} Answer concisely in plain text, always listing full IRIs."""

STRUCTURE_PROMPT = f"""You are a structural specialist for a hot-stamped automotive B-pillar.
Use the ontology tools to describe components, interfaces (which components they join, which process joins them)
and the manufacturing processes involved together with the causes they induce.
{IRI_RULE} Answer concisely in plain text, always listing full IRIs."""

ANALYST_PROMPT = f"""You are the lead DFMEA analyst. You do not have direct ontology access; you must consult:
- structure_specialist: components, interfaces, processes and the causes they induce
- failure_mode_specialist: failure modes, causal chains, effects, detection/prevention controls
Call each specialist at most {MAX_SPECIALIST_CALLS} times. Ask focused, complete questions.

Produce DFMEA findings for the target component and scenario:
- component_iri must be the location where the failure mode occurs (its occursAt IRI).
- cause_path lists IRIs from the root (a Process or a Cause) to the immediate cause of the failure mode.
  Every adjacent pair, and the last cause -> failure mode -> effect, must be a direct edge reported by the specialist.
- severity/occurrence/detection are integers 1-10 (use the effect's defaultSeverity as a reference for severity).
- confidence 0-1 reflects how well the ontology evidence supports the finding and how applicable it is to the scenario.
{IRI_RULE}"""


@dataclass
class UsageTracker:
    input_tokens: int = 0
    output_tokens: int = 0
    per_agent: dict[str, dict[str, int]] = field(default_factory=dict)

    def add(self, name: str, result: Any) -> None:
        u = result.metrics.accumulated_usage
        i, o = int(u.get("inputTokens", 0)), int(u.get("outputTokens", 0))
        self.input_tokens += i
        self.output_tokens += o
        agg = self.per_agent.setdefault(name, {"inputTokens": 0, "outputTokens": 0, "calls": 0})
        agg["inputTokens"] += i
        agg["outputTokens"] += o
        agg["calls"] += 1

    def as_dict(self) -> dict[str, Any]:
        return {
            "inputTokens": self.input_tokens,
            "outputTokens": self.output_tokens,
            "totalTokens": self.input_tokens + self.output_tokens,
            "perAgent": self.per_agent,
        }


class ToolCallEmitter(HookProvider):
    def __init__(self, agent_name: str, emit: Emit) -> None:
        self.agent_name = agent_name
        self.emit = emit

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(BeforeToolCallEvent, self._on_tool)

    def _on_tool(self, event: BeforeToolCallEvent) -> None:
        tu = event.tool_use
        self.emit("agent.tool_call", {"agent": self.agent_name, "tool": tu.get("name"), "input": tu.get("input")})


def _model(model_id: str, max_tokens: int) -> BedrockModel:
    return BedrockModel(
        model_id=model_id, region_name=config.REGION, boto_client_config=config.BEDROCK_CONFIG, max_tokens=max_tokens
    )


@dataclass
class AnalysisResult:
    findings: ReviewFindings
    usage: dict[str, Any]
    elapsed_sec: float


def run_analysis(store: OntologyStore, component_iri: str, scenario: str, emit: Emit) -> AnalysisResult:
    started = time.monotonic()
    usage = UsageTracker()
    tools = make_ontology_tools(store)
    counts = {"failure_mode_specialist": 0, "structure_specialist": 0}

    def call_specialist(name: str, prompt: str, tool_list: list[Any], question: str) -> str:
        counts[name] += 1
        if counts[name] > MAX_SPECIALIST_CALLS:
            return f"Call limit reached: {name} may be called at most {MAX_SPECIALIST_CALLS} times."
        emit("agent.started", {"agent": name, "question": question})
        t0 = time.monotonic()
        agent = Agent(
            name=name,
            model=_model(config.SPECIALIST_MODEL_ID, 4096),
            system_prompt=prompt,
            tools=tool_list,
            hooks=[ToolCallEmitter(name, emit)],
            callback_handler=None,
        )
        result = agent(question)
        usage.add(name, result)
        text = str(result)
        emit("agent.finished", {"agent": name, "elapsedSec": round(time.monotonic() - t0, 2), "chars": len(text)})
        return text

    @tool
    def failure_mode_specialist(question: str) -> str:
        """Ask the failure-mode specialist about failure modes, causal chains, effects and controls.

        Args:
            question: A focused, self-contained question including any IRIs of interest.
        """
        return call_specialist("failure_mode_specialist", FAILURE_MODE_PROMPT, tools["failure_mode"], question)

    @tool
    def structure_specialist(question: str) -> str:
        """Ask the structure specialist about components, interfaces and manufacturing processes.

        Args:
            question: A focused, self-contained question including any IRIs of interest.
        """
        return call_specialist("structure_specialist", STRUCTURE_PROMPT, tools["structure"], question)

    emit("agent.started", {"agent": "analyst", "model": config.ANALYST_MODEL_ID})
    analyst = Agent(
        name="analyst",
        model=_model(config.ANALYST_MODEL_ID, 8192),
        system_prompt=ANALYST_PROMPT,
        tools=[structure_specialist, failure_mode_specialist],
        callback_handler=None,
    )
    task = json.dumps({"target_component_iri": component_iri, "scenario": scenario}, ensure_ascii=False)
    result = analyst(f"Review request:\n{task}", structured_output_model=ReviewFindings)
    usage.add("analyst", result)
    findings = result.structured_output
    if not isinstance(findings, ReviewFindings):
        raise RuntimeError("analyst did not return structured ReviewFindings")
    elapsed = round(time.monotonic() - started, 2)
    emit("agent.finished", {"agent": "analyst", "elapsedSec": elapsed, "findings": len(findings.findings)})
    return AnalysisResult(findings=findings, usage=usage.as_dict(), elapsed_sec=elapsed)
