import type { FunctionCall, FunctionDeclaration } from '@google/genai';

export interface AssistantToolSpec {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

export interface GeminiToolDeclaration extends FunctionDeclaration {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

/** Gemini can take JSON Schema directly. Do not translate or discard validation constraints. */
export function toGeminiDeclaration({ name, description, schema }: AssistantToolSpec): GeminiToolDeclaration {
  const { $schema: _dialect, ...parametersJsonSchema } = schema;
  return { name, description, parametersJsonSchema };
}

/** Route a model function call to the existing SBX-1 door. The caller supplies the sandbox token
 * in HTTP headers, never as a model argument. The server still decides which command can be drafted. */
export function sandboxRequestForGeminiCall(sandboxId: string, call: FunctionCall) {
  const { name, args = {} } = call;
  if (!name || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) throw new Error('Invalid assistant function name');
  const base = `/api/v1/sandboxes/${encodeURIComponent(sandboxId)}`;
  if (name.startsWith('propose_')) {
    const parts = /^propose_([a-z][a-z0-9]*)_([a-z][a-z0-9]*)$/.exec(name);
    if (!parts) throw new Error('Invalid proposal function name');
    return { method: 'POST', path: `${base}/steps`, body: { command: `${parts[1]}.${parts[2]}`, input: args } } as const;
  }
  return { method: 'POST', path: `${base}/tools/${name}`, body: args } as const;
}
