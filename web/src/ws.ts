import { idToken } from './auth';
import { config } from './config';
import { AppError } from './errors';
import type { ReviewEvent } from './types';

/** Opens the review event socket. Resolves once the socket is open. */
export async function openReviewSocket(
  reviewId: string,
  onEvent: (e: ReviewEvent) => void,
  onClose: () => void,
): Promise<WebSocket> {
  const token = await idToken();
  const url = `${config().wsUrl}?token=${encodeURIComponent(token)}&reviewId=${encodeURIComponent(reviewId)}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let opened = false;
    ws.onopen = () => {
      opened = true;
      resolve(ws);
    };
    ws.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data as string) as ReviewEvent);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onerror = () => {
      if (!opened) reject(new AppError('wsConnect'));
    };
    ws.onclose = () => {
      if (opened) onClose();
    };
  });
}
