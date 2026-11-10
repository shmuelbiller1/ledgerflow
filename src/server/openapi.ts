import { z } from 'zod';
import { TransactionSchema } from '../schemas';

import { BRAND_NAME } from '../config/brand';
/**
 * The public API described for tools (Z-01): an OpenAPI 3.1 document built from the code. The entry
 * shape is the same schema the server checks requests with (`TransactionSchema`, as JSON Schema), so
 * the two cannot drift; the paths are the transaction endpoints API keys use. Served at
 * GET /api/v1/openapi.json (no sign-in needed: it describes, it does not open anything).
 */
const generated = z.toJSONSchema(TransactionSchema, { io: 'input', unrepresentable: 'any' }) as { required?: string[] } & Record<string, unknown>;
// the server fills in who made the entry; a client never sends it
const entrySchema = { ...generated, required: (generated.required || []).filter(key => key !== 'uid') };

const error = (description: string) => ({ description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });
const json = (schema: object) => ({ 'application/json': { schema } });
const workspaceParam = { name: 'workspaceId', in: 'query', required: true, schema: { type: 'string' } };
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };

export function openApiDocument(serverUrl = '/') {
  return {
    openapi: '3.1.0',
    info: {
      title: `${BRAND_NAME} API`,
      version: '1',
      description: 'Entries in a workspace\'s books. Authenticate with an API key (`X-API-Key: <keyId>.<secret>`) or a signed-in session token. Amounts are whole cents; an entry\'s lines add up to zero.',
    },
    servers: [{ url: serverUrl }],
    security: [{ apiKey: [] }, { bearer: [] }],
    components: {
      securitySchemes: {
        apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        bearer: { type: 'http', scheme: 'bearer' },
      },
      schemas: {
        Transaction: entrySchema,
        Error: { type: 'object', properties: { status: { type: 'string' }, error: { type: 'string' }, message: { type: 'string' } } },
      },
    },
    paths: {
      '/api/v1/transactions': {
        get: {
          summary: 'List entries, newest first',
          parameters: [
            workspaceParam,
            { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'accountId', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 1000, default: 100 } },
            { name: 'cursor', in: 'query', description: 'The `nextCursor` of the previous page', schema: { type: 'string' } },
            { name: 'fields', in: 'query', description: 'Only these fields of each entry (and its id), comma-separated (Z-04)', schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'A page of entries (with an ETag; send it as If-None-Match for a 304)', content: json({ type: 'object', properties: { transactions: { type: 'array', items: { $ref: '#/components/schemas/Transaction' } }, nextCursor: { type: ['string', 'null'] } } }) },
            304: { description: 'Not modified since the ETag sent' },
            400: error('A bad parameter'), 403: error('Not a member of the workspace'),
          },
        },
        post: {
          summary: 'Create one entry',
          requestBody: { required: true, content: json({ type: 'object', required: ['transaction'], properties: { transaction: { $ref: '#/components/schemas/Transaction' } } }) },
          responses: { 200: { description: 'Created' }, 400: error('Refused (unbalanced, unknown account, bad field)'), 402: error('Over the plan\'s entry limit'), 409: error('In a closed period') },
        },
      },
      '/api/v1/transactions/batch-create': {
        post: {
          summary: 'Create up to 500 entries, all or none (Z-03)',
          requestBody: { required: true, content: json({ type: 'object', required: ['workspaceId', 'transactions'], properties: { workspaceId: { type: 'string' }, transactions: { type: 'array', maxItems: 500, items: { $ref: '#/components/schemas/Transaction' } } } }) },
          responses: { 200: { description: 'All created; their ids in the order sent', content: json({ type: 'object', properties: { data: { type: 'object', properties: { created: { type: 'integer' }, ids: { type: 'array', items: { type: 'string' } } } } } }) }, 400: error('One entry refused (named by index); nothing written'), 402: error('Over the plan\'s entry limit'), 409: error('An entry in a closed period, or an id that exists') },
        },
      },
      '/api/v1/transactions/{id}': {
        put: {
          summary: 'Change an entry',
          parameters: [idParam, { name: 'If-Match', in: 'header', description: 'The entry\'s updatedAt in quotes: refused with 412 if it changed since (Z-05)', schema: { type: 'string' } }],
          requestBody: { required: true, content: json({ type: 'object', properties: { transaction: { $ref: '#/components/schemas/Transaction' }, partialUpdate: { type: 'object' } } }) },
          responses: { 200: { description: 'Saved' }, 409: error('Changed since (expectedUpdatedAt) or a closed period'), 412: error('Changed since the If-Match version') },
        },
        delete: {
          summary: 'Delete an entry (drafts only; void a posted one instead)',
          parameters: [idParam],
          responses: { 200: { description: 'Deleted' }, 403: error('Not allowed'), 409: error('In a closed period') },
        },
      },
    },
  };
}
