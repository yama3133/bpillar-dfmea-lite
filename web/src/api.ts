import { idToken } from './auth';
import { config } from './config';
import type { ComponentNode, ReviewEvent, ReviewResponse } from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(config().restUrl.replace(/\/$/, '') + path, {
    method,
    headers: { Authorization: await idToken(), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (json as { message?: string }).message ?? `HTTP ${res.status}`);
  return json as T;
}

export const api = {
  components: () => call<{ versionInfo: string; components: ComponentNode[] }>('GET', '/ontology/components'),
  createReview: (reviewId: string, componentIri: string, scenario: string) =>
    call<{ reviewId: string }>('POST', '/reviews', { reviewId, componentIri, scenario }),
  getReview: (id: string) => call<ReviewResponse>('GET', `/reviews/${id}`),
  events: (id: string, after: number) =>
    call<{ events: ReviewEvent[] }>('GET', `/reviews/${id}/events?after=${after}`),
  decide: (id: string, decision: 'approve' | 'reject', comment: string) =>
    call<{ decision: string }>('POST', `/reviews/${id}/decision`, { decision, comment }),
};
