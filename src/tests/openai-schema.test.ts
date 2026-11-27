import test from 'node:test';
import assert from 'node:assert/strict';
import { closedSchema } from '../server/services/openAiCompatibleClient';

test('JSON schemas are closed for OpenAI-style strict output: no extra fields, all listed, optional ones nullable', () => {
  const schema = {
    type: 'object',
    properties: {
      total: { type: 'string' },
      tax: { type: 'string' },
      lines: { type: 'array', items: { type: 'object', properties: { description: { type: 'string' }, amount: { type: 'string' } }, required: ['description'] } },
    },
    required: ['total'],
  };
  assert.deepEqual(closedSchema(schema), {
    type: 'object',
    properties: {
      total: { type: 'string' },
      tax: { type: ['string', 'null'] },
      lines: { type: ['array', 'null'], items: { type: 'object', properties: { description: { type: 'string' }, amount: { type: ['string', 'null'] } }, required: ['description', 'amount'], additionalProperties: false } },
    },
    required: ['total', 'tax', 'lines'],
    additionalProperties: false,
  });
});
