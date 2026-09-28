export type EventType =
  | 'review.accepted' | 'ontology.pinned' | 'agent.started' | 'agent.finished' | 'agent.tool_call'
  | 'findings.proposed' | 'validation.result' | 'hitl.required' | 'hitl.decided'
  | 'review.completed' | 'review.failed';

export interface ReviewEvent {
  v: 1;
  reviewId: string;
  seq: number;
  ts: string;
  type: EventType;
  data: Record<string, unknown>;
}

export interface Validation {
  status: 'accepted' | 'rejected';
  code: string;
  detail: string;
}

export interface Finding {
  finding_id: string;
  component_iri: string;
  failure_mode_iri: string;
  cause_path: string[];
  effect_iri: string;
  severity: number;
  occurrence: number;
  detection: number;
  confidence: number;
  rationale: string;
  recommended_actions: string[];
  rpn: number;
  validation?: Validation;
}

export interface Review {
  reviewId: string;
  status: string;
  componentIri: string;
  scenario: string;
  ontology?: { versionInfo?: string; versionId?: string; sha256?: string };
  report?: { outcome: string; ontology: { versionInfo?: string } };
  usage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number };
  analysisSec?: number;
  decision?: { decision: string; comment: string; by: string };
}

export interface ReviewResponse {
  review: Review;
  findings: { accepted: Finding[]; rejected: Finding[]; pending: Finding[] };
}

export interface ComponentNode {
  iri: string;
  label: string;
  comment: string;
  kind: 'Component' | 'Interface';
}

export const TERMINAL: EventType[] = ['review.completed', 'review.failed'];

export const localName = (iri: string) => iri.slice(iri.lastIndexOf('/') + 1);
