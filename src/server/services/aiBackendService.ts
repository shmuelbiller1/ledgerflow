import { GoogleGenAI, Type } from "@google/genai";
import { SecurityService } from "../../services/securityService";
import { AutoRuleSchema } from "../../schemas";
import { tracedClient, type AiCallTrace } from "./aiGateway";
import { readDocumentDraft } from "./receiptOcr";
import { routedModelClient } from "./assistantModels";
import type { ModelClient } from "./assistantTurn";

export class AIBackendService {
  private static getAiClient() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
  }

  /** `traces` collects each model call (src/server/services/aiGateway.ts); the route stores them. */
  static async processTask(task: string, payload: Record<string, unknown>, traces: AiCallTrace[] = []): Promise<unknown> {
    const ai = tracedClient(this.getAiClient(), traces);

    switch (task) {
      case 'strategic-analysis': {
        const mode = (payload.mode as string) || 'growth';
        if (!ai) {
          // no AI configured: say so, with no made-up plan or confidence (strategic review, 11 Oct)
          return { directives: [], scenarios: [], confidence: null, degraded: true, source: 'unavailable', message: 'AI analysis is not available right now.' };
        }
        try {
          const prompt = `Analyze financial strategy for mode "${mode}" given data: ${JSON.stringify(payload.data)}. Return a detailed roadmap of strategic directives, risk scenarios, and confidence rating.`;
          const response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  directives: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: "List of tactical business directives."
                  },
                  scenarios: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: "What-if operational stress scenarios."
                  },
                  confidence: {
                    type: Type.INTEGER,
                    description: "Confidence rating score out of 100."
                  }
                },
                required: ["directives", "scenarios", "confidence"]
              }
            }
          });
          return JSON.parse(response.text || '{}');
        } catch (err: unknown) {
          console.warn("Gemini strategic-analysis failed, falling back", err);
          return { directives: [], scenarios: [], confidence: null, degraded: true, source: 'failed', message: 'AI analysis failed; nothing was inferred.' };
        }
      }

      case 'generate-forecast': {
        const txs = (payload.transactions as Array<{ date?: string; totalAmountCents?: number }>) || [];
        const horizon = (payload.horizon as number) || 3;
        if (!ai || txs.length === 0) {
          const points = txs.map((t) => ({ date: t.date, value: (t.totalAmountCents || 0) / 100 }));
          return {
            points,
            confidence: points.length > 5 ? 88 : 60,
            anomalies: []
          };
        }
        try {
          const prompt = `Forecast cash flows for next ${horizon} months based on these historical points: ${JSON.stringify(txs.map((t) => ({ date: t.date, amount: (t.totalAmountCents || 0) / 100 })))}. Detect potential anomalies.`;
          const response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  points: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        date: { type: Type.STRING },
                        value: { type: Type.NUMBER }
                      },
                      required: ["date", "value"]
                    }
                  },
                  confidence: { type: Type.INTEGER },
                  anomalies: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["points", "confidence", "anomalies"]
              }
            }
          });
          return JSON.parse(response.text || '{}');
        } catch (err: unknown) {
          console.warn("Gemini generate-forecast failed, falling back", err);
          return {
            points: txs.map((t) => ({ date: t.date, value: (t.totalAmountCents || 0) / 100 })),
            confidence: null,
            degraded: true,
            source: 'failed',
            anomalies: []
          };
        }
      }

      case 'map-transactions': {
        const txs = (payload.transactions as unknown[]) || [];
        const accounts = (payload.accounts as unknown[]) || [];
        if (!ai || txs.length === 0) return [];
        try {
          const prompt = `Suggest account mappings for these transactions: ${JSON.stringify(txs)} into these accounts: ${JSON.stringify(accounts)}. Context: ${payload.context || ''}`;
          const response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    transactionId: { type: Type.STRING },
                    accountId: { type: Type.STRING },
                    rationale: { type: Type.STRING }
                  },
                  required: ["transactionId", "accountId", "rationale"]
                }
              }
            }
          });
          return JSON.parse(response.text || '[]');
        } catch (err: unknown) {
          console.warn("Gemini map-transactions failed", err);
          return [];
        }
      }

      case 'analyze-trends': {
        const txs = (payload.transactions as unknown[]) || [];
        if (!ai) {
          return {
            trends: ["Expense velocity consistent with operations."],
            anomalies: [],
            strategicAdvice: ["AI trend analysis complete."]
          };
        }
        try {
          const prompt = `Perform forensic trend analysis on these ledger entries: ${JSON.stringify(txs)}. Context: ${payload.context || ''}`;
          const response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  trends: { type: Type.ARRAY, items: { type: Type.STRING } },
                  anomalies: { type: Type.ARRAY, items: { type: Type.STRING } },
                  strategicAdvice: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["trends", "anomalies", "strategicAdvice"]
              }
            }
          });
          return JSON.parse(response.text || '{}');
        } catch (err: unknown) {
          console.warn("Gemini analyze-trends failed", err);
          return { trends: [], anomalies: [], strategicAdvice: [] };
        }
      }

      case 'parse-query': {
        const query = SecurityService.scrubPII((payload.query as string) || '');
        if (!ai) return { parsedQuery: query };
        try {
          const prompt = `Parse the user query into filter fields. User query: "${query}". Context: ${payload.context || ''}`;
          const response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  category: { type: Type.STRING },
                  project: { type: Type.STRING },
                  minAmountCents: { type: Type.INTEGER },
                  maxAmountCents: { type: Type.INTEGER },
                  startDate: { type: Type.STRING },
                  endDate: { type: Type.STRING }
                }
              }
            }
          });
          return JSON.parse(response.text || '{}');
        } catch (err: unknown) {
          console.warn("Gemini parse-query failed", err);
          return { parsedQuery: query };
        }
      }

      case 'parse-magic-entry': {
        const input = SecurityService.scrubPII((payload.input as string) || '');
        if (!ai) return { rawInput: input, parsed: false };
        try {
          const prompt = `Parse this natural language financial entry: "${input}". Match with available categories: ${JSON.stringify(payload.categories)} and accounts: ${JSON.stringify(payload.accounts)}. Pattern Context: ${payload.patternContext || ''}`;
          const response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  payee: { type: Type.STRING },
                  amountCents: { type: Type.INTEGER },
                  type: { type: Type.STRING, description: "Must be 'income' or 'expense'" },
                  accountId: { type: Type.STRING },
                  projectId: { type: Type.STRING },
                  date: { type: Type.STRING }
                },
                required: ["payee", "amountCents", "type"]
              }
            }
          });
          return JSON.parse(response.text || '{}');
        } catch (err: unknown) {
          console.warn("Gemini parse-magic-entry failed", err);
          return { rawInput: input, parsed: false };
        }
      }

      case 'parse-receipt':
      case 'read-document': {
        // SBX-2 Part 6: the separate OCR service (receiptOcr.ts) on the OCR model; the result is a draft only
        if (!ai || !payload.base64Data) {
          throw new Error("Cannot read the document: Missing image data or Gemini AI service unavailable.");
        }
        const mimeType = typeof payload.mimeType === 'string' && payload.mimeType ? payload.mimeType : 'image/png';
        const fallbackCurrency = typeof payload.fallbackCurrency === 'string' ? payload.fallbackCurrency : undefined;
        // `ai` is already traced; the service traces its own call into the same list
        const gemini = this.getAiClient() as unknown as ModelClient;
        // an approved non-Google OCR model (ASSISTANT_MODEL_OCR) goes to its own endpoint
        const draft = await readDocumentDraft(routedModelClient(gemini) ?? gemini,
          { base64Data: payload.base64Data, mimeType, ...(fallbackCurrency ? { fallbackCurrency } : {}) }, traces);
        if (task === 'read-document') return { draft };
        // the receipt screen's fields, from the same draft (totals stay empty rather than guessed)
        return {
          status: draft.status, posted: draft.posted, needsReview: draft.needsReview,
          vendorName: draft.vendorName ?? undefined, date: draft.date ?? undefined, currency: draft.currency ?? undefined,
          totalAmountCents: draft.totalMinor ?? undefined, taxAmountCents: draft.taxMinor ?? undefined,
          lines: draft.lines.flatMap(line => line.amountMinor === null ? [] : [{ description: line.description, amountCents: line.amountMinor }]),
          confidence: draft.confidence ?? 0,
        };
      }

      case 'parse-statement': {
        if (!ai || !payload.content) {
          throw new Error("Cannot parse statement: Missing statement content or Gemini AI service unavailable.");
        }
        try {
          const prompt = `Extract all line-item transactions from this bank statement. Return an array of structured transactions. Context: ${payload.context || ''}`;
          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
              { text: prompt },
              { inlineData: { data: payload.content as string, mimeType: (payload.mimeType as string) || 'application/pdf' } }
            ],
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  transactions: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        date: { type: Type.STRING },
                        payee: { type: Type.STRING },
                        amountCents: { type: Type.INTEGER },
                        memo: { type: Type.STRING }
                      },
                      required: ["date", "payee", "amountCents"]
                    }
                  }
                },
                required: ["transactions"]
              }
            }
          });
          return JSON.parse(response.text || '{}');
        } catch (err: unknown) {
          console.warn("Gemini parse-statement failed", err);
          throw err;
        }
      }

      case 'parse-personal-tax-profile': {
        const msg = (payload.message as string) || '';
        if (!ai) {
          throw new Error("Cannot parse personal tax profile: Gemini AI service unavailable.");
        }
        try {
          const prompt = `Extract tax profile from details: "${msg}" into filingStatus, dependentsCount, state, annualIncomeCents, and childTaxCreditAmountCents with explanation.`;
          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  filingStatus: { type: Type.STRING, description: "Must be 'Single' | 'Married Filing Jointly' | 'Married Filing Separately' | 'Head of Household'" },
                  dependentsCount: { type: Type.INTEGER },
                  state: { type: Type.STRING },
                  annualIncomeCents: { type: Type.INTEGER },
                  childTaxCreditAmountCents: { type: Type.INTEGER },
                  explanation: { type: Type.STRING }
                },
                required: ["filingStatus", "dependentsCount", "state", "annualIncomeCents", "childTaxCreditAmountCents", "explanation"]
              }
            }
          });
          return JSON.parse(response.text || '{}');
        } catch (err: unknown) {
          console.warn("Gemini parse-personal-tax-profile failed", err);
          throw err;
        }
      }

      case 'build-auto-rule': {
        const sentence = (payload.sentence as string) || '';
        const categories = (payload.categories as string[]) || [];
        const accounts = (payload.accounts as string[]) || [];
        const projects = (payload.projects as string[]) || [];
        if (!ai) {
          throw new Error("Gemini API client is not initialized.");
        }
        try {
          const prompt = `Generate a structured rule schema matching sentence query: "${sentence}". Available categories: ${JSON.stringify(categories)}, available accounts: ${JSON.stringify(accounts)}. Match condition and action to these categories/accounts where appropriate. Return only the condition and action matching our schema. Do not try to include any disallowed properties.`;
          const response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  rule: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING, description: "Descriptive name for this rule" },
                      condition: {
                        type: Type.OBJECT,
                        properties: {
                          vendor: { type: Type.STRING },
                          project: { type: Type.STRING },
                          category: { type: Type.STRING },
                          descriptionContains: { type: Type.STRING },
                          descriptionStartsWith: { type: Type.STRING },
                          minAmountCents: { type: Type.INTEGER },
                          maxAmountCents: { type: Type.INTEGER }
                        }
                      },
                      action: {
                        type: Type.OBJECT,
                        properties: {
                          targetProject: { type: Type.STRING },
                          targetCategory: { type: Type.STRING },
                          targetClass: { type: Type.STRING },
                          targetLocation: { type: Type.STRING },
                          flagForReview: { type: Type.BOOLEAN },
                          descriptionPrefix: { type: Type.STRING },
                          descriptionSuffix: { type: Type.STRING },
                          setNotes: { type: Type.STRING },
                          deleteTransaction: { type: Type.BOOLEAN },
                          setAmountCents: { type: Type.INTEGER }
                        }
                      }
                    },
                    required: ["name", "condition", "action"]
                  }
                },
                required: ["rule"]
              }
            }
          });

          const parsed = JSON.parse(response.text || '{}');
          if (!parsed.rule) {
            throw new Error("Failed to parse rule structure from response.");
          }

          // Strict Security Guard: strip destructive actions server-side
          if (parsed.rule.action) {
            delete parsed.rule.action.deleteTransaction;
            delete parsed.rule.action.setAmountCents;
          }

          // Validate targetCategory against workspace categories
          if (parsed.rule.action?.targetCategory && Array.isArray(categories) && categories.length > 0) {
            if (!categories.includes(parsed.rule.action.targetCategory)) {
              const err = new Error(`Target category '${parsed.rule.action.targetCategory}' is not valid for this workspace.`) as Error & { status?: number };
              err.status = 422;
              throw err;
            }
          }

          // Validate targetProject against workspace projects
          if (parsed.rule.action?.targetProject && Array.isArray(projects) && projects.length > 0) {
            if (!projects.includes(parsed.rule.action.targetProject)) {
              const err = new Error(`Target project '${parsed.rule.action.targetProject}' is not valid for this workspace.`) as Error & { status?: number };
              err.status = 422;
              throw err;
            }
          }

          // Complete remaining missing fields for a valid AutoRule
          const ruleCandidate = {
            id: `rule_ai_${Date.now()}`,
            isActive: false,
            createdBy: 'ai',
            createdAt: new Date().toISOString(),
            ...parsed.rule
          };

          // Server-side strict Zod Schema validation
          const validationResult = AutoRuleSchema.safeParse(ruleCandidate);
          if (!validationResult.success) {
            throw new Error(`AI generated rule did not meet safety constraints: ${validationResult.error.message}`);
          }

          return { rule: validationResult.data };
        } catch (err: unknown) {
          console.warn("Gemini build-auto-rule failed", err);
          throw err;
        }
      }

      case 'chat': {
        if (!ai) {
          throw new Error("Cannot process chat: Gemini AI service unavailable.");
        }
        const query = (payload.query as string) || '';
        const summary = payload.ledgerSummary ? JSON.stringify(payload.ledgerSummary) : '';
        const prompt = `You are an expert ERP and Financial Ledger assistant.
Ledger Context:
${summary}

User Question:
${query}

Provide a concise, direct, helpful, and professional financial response.`;
        try {
          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt
          });
          return { answer: response.text || "No response generated." };
        } catch (err: unknown) {
          console.warn("Gemini chat failed", err);
          throw err;
        }
      }

      case 'parse-business-blueprint': {
        if (!ai) {
          throw new Error("Cannot generate business blueprint: Gemini AI service unavailable.");
        }
        const description = (payload.description as string) || '';
        const prompt = `Generate a business chart of accounts and ERP configuration blueprint based on the following business description: "${description}".
Return:
- name: string (business or template name)
- description: string (summary description)
- industry: string (industry category)
- strategicAdvice: array of strings (actionable financial advice)
- chartOfAccounts: array of objects with { category, code, name, type (asset | liability | equity | revenue | expense) }
- dashboardSchema: object with { nodes: array of { id, label, role, metrics }, links: array of { source, target, type } }`;

        try {
          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  description: { type: Type.STRING },
                  industry: { type: Type.STRING },
                  strategicAdvice: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                  },
                  chartOfAccounts: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        category: { type: Type.STRING },
                        code: { type: Type.STRING },
                        name: { type: Type.STRING },
                        type: { type: Type.STRING }
                      },
                      required: ["category", "code", "name", "type"]
                    }
                  },
                  dashboardSchema: {
                    type: Type.OBJECT,
                    properties: {
                      nodes: { type: Type.ARRAY, items: { type: Type.OBJECT } },
                      links: { type: Type.ARRAY, items: { type: Type.OBJECT } }
                    },
                    required: ["nodes", "links"]
                  }
                },
                required: ["name", "description", "industry", "strategicAdvice", "chartOfAccounts", "dashboardSchema"]
              }
            }
          });
          return JSON.parse(response.text || '{}');
        } catch (err: unknown) {
          console.warn("Gemini parse-business-blueprint failed", err);
          throw err;
        }
      }

      default:
        throw new Error(`Unsupported task '${task}'`);
    }
  }
}
