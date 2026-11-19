import { useCallback, useEffect, useState } from 'react';
import { runCommand } from '../lib/runCommand';
import { buildExplainBody, parseExplanation, type ExplainRequest, type Explanation } from '../lib/reportExplain';

export interface FigureExplanationState {
  /** the server's answer, once it has arrived */
  data: Explanation | null;
  /** still asking */
  loading: boolean;
  /** the answer could not be read (offline, refused, an older server) */
  failed: boolean;
  /** ask again after a failure */
  retry: () => void;
}

/** One answer, remembered with the request it belongs to — so another request never shows it. */
interface Answer {
  key: string;
  data: Explanation | null;
  failed: boolean;
}

const NO_ANSWER: Answer = { key: '', data: null, failed: false };

/**
 * Asks the server for the posted lines behind one figure (R-7, N-12). A `null` request does nothing:
 * the panel uses that for a side it is not showing, so the hook is always called and the rule of
 * hooks is kept.
 *
 * The request text is the effect's key, so a new period or a new account asks again, and an answer
 * for an old request never lands on the new one (`live` is cleared on cleanup). The last answer is
 * kept beside its request: a request that has not been answered yet reads as loading, not as the
 * previous figure's lines.
 */
export function useFigureExplanation(workspaceId: string | null | undefined, request: ExplainRequest | null): FigureExplanationState {
  const body = workspaceId && request ? buildExplainBody(workspaceId, request) : '';
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<Answer>(NO_ANSWER);
  const key = `${attempt}|${body}`;

  useEffect(() => {
    if (!body) return;
    let live = true;
    runCommand<Partial<Explanation> | null>({ path: '/api/v1/reports/explain', method: 'POST', rawBody: body })
      .then(payload => {
        if (!live) return;
        try {
          setAnswer({ key: `${attempt}|${body}`, data: parseExplanation(payload), failed: false });
        } catch {
          setAnswer({ key: `${attempt}|${body}`, data: null, failed: true });
        }
      })
      .catch(() => {
        if (live) setAnswer({ key: `${attempt}|${body}`, data: null, failed: true });
      });
    return () => {
      live = false;
    };
  }, [body, attempt]);

  const retry = useCallback(() => setAttempt(n => n + 1), []);
  const current = answer.key === key ? answer : NO_ANSWER;
  return {
    data: current.data,
    loading: Boolean(body) && !current.data && !current.failed,
    failed: Boolean(body) && current.failed,
    retry,
  };
}
