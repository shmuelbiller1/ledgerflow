/**
 * The response a route handler is handed in a test that calls the handler directly: it records the
 * status and the body the handler set, and answers itself so chained `res.status(…).json(…)` works.
 *
 * `recordingResponse()` is the whole of it — the tests that call `handleReconcile(req, res, db)` by
 * hand used to spell out the same two-method object, which is how their assertions drifted apart.
 */
import type express from 'express';
import type { TestResponseBody } from './mockTypes';

export interface RecordingResponse {
  /** the `res` to pass to the handler */
  res: express.Response;
  /** the last status the handler set (200 until it sets one) */
  statusCode: number;
  /** the last body the handler sent, if it sent one */
  body: TestResponseBody | null;
}

export function recordingResponse(): RecordingResponse {
  const recorded: RecordingResponse = {
    statusCode: 200,
    body: null,
    res: undefined as unknown as express.Response,
  };
  recorded.res = {
    status: (code: number) => {
      recorded.statusCode = code;
      return recorded.res;
    },
    json: (data: TestResponseBody) => {
      recorded.body = data;
      return recorded.res;
    },
  } as unknown as express.Response;
  return recorded;
}
