import { errorMessage } from '../auth/requestUser';
import { getDb } from '../db/firestore';
import { sendErrorDigestEmail, ErrorGroupSummary } from './emailService';
import { sha256Sync } from '../../lib/algorithms';

export interface ProcessErrorDigestOptions {
  hoursBack?: number;
  recipientEmail?: string;
  forceSendZero?: boolean;
  dbOverride?: any;
}

export interface ProcessErrorDigestResult {
  processed: boolean;
  totalErrors: number;
  uniqueErrors: number;
  delivered: boolean;
  recipient: string;
  provider?: string;
  error?: string;
  groups: ErrorGroupSummary[];
}

/**
 * Generates a deterministic fingerprint key for error grouping.
 * Normalizes dynamic identifiers (UUIDs, IDs, digits, quotes) and incorporates
 * normalized top stack frame signatures.
 */
export function generateErrorFingerprint(source: string, message: string, stack?: string): string {
  if (!message) message = 'Unknown error';

  // Deterministic normalization pipeline:
  // 1. UUIDs & long hex identifiers -> <id>
  let normalizedMsg = message
    .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '<id>')
    .replace(/\b[a-f0-9]{24,32}\b/gi, '<id>');

  // 2. Numeric runs -> #
  normalizedMsg = normalizedMsg.replace(/\b\d+\b/g, '#');

  // 3. Quoted strings -> <str>
  normalizedMsg = normalizedMsg
    .replace(/"[^"]*"/g, '"<str>"')
    .replace(/'[^']*'/g, "'<str>'");

  // 4. Normalize whitespace
  normalizedMsg = normalizedMsg.replace(/\s+/g, ' ').trim();

  // 5. Normalize top stack frames if present (top 3 frames, paths preserved, line/column stripped)
  let stackSignature = '';
  if (stack && typeof stack === 'string') {
    const lines = stack.split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('at ') || l.includes('@'));

    const topFrames = lines.slice(0, 3).map(frame => {
      return frame
        .replace(/:\d+:\d+/g, '')
        .replace(/:\d+/g, '')
        .replace(/\?.*$/g, '');
    });

    if (topFrames.length > 0) {
      stackSignature = '::' + topFrames.join('|');
    }
  }

  const canonicalSignature = `${source}::${normalizedMsg}${stackSignature}`;
  return sha256Sync(canonicalSignature);
}

/**
 * Pure aggregation function: groups raw telemetry documents by normalized signature fingerprint,
 * orders by frequency descending, and preserves worst-case severity and timestamps.
 */
export function aggregateErrorSignatures(rawDocs: any[]): {
  groups: ErrorGroupSummary[];
  totalErrors: number;
  uniqueErrors: number;
} {
  const groupMap = new Map<string, ErrorGroupSummary>();

  for (const doc of rawDocs) {
    const msg = (doc.message || 'Unknown error').trim();
    const source = doc.source || 'frontend';
    const severity = doc.severity || 'error';
    const stack = doc.stack || doc.componentStack || undefined;
    const key = generateErrorFingerprint(source, msg, stack);
    const timestamp = doc.createdAt || new Date().toISOString();

    const existing = groupMap.get(key);
    if (!existing) {
      groupMap.set(key, {
        message: msg,
        count: 1,
        source,
        severity,
        firstSeen: timestamp,
        lastSeen: timestamp,
        sampleStack: stack,
        sampleUrl: doc.url || undefined
      });
    } else {
      existing.count += 1;
      if (timestamp < existing.firstSeen) existing.firstSeen = timestamp;
      if (timestamp > existing.lastSeen) existing.lastSeen = timestamp;
      if (severity === 'fatal' || (severity === 'error' && existing.severity !== 'fatal')) {
        existing.severity = severity;
      }
      if (!existing.sampleStack && stack) {
        existing.sampleStack = stack;
      }
    }
  }

  const groups = Array.from(groupMap.values()).sort((a, b) => b.count - a.count);
  return {
    groups,
    totalErrors: rawDocs.length,
    uniqueErrors: groups.length
  };
}

/**
 * Aggregates error signatures from Firestore errorLogs over the specified time period
 * and dispatches a grouped digest summary via emailService.
 */
export async function processErrorDigest(options?: ProcessErrorDigestOptions): Promise<ProcessErrorDigestResult> {
  const hoursBack = options?.hoursBack && options.hoursBack > 0 ? options.hoursBack : 24;
  const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
  const recipient = options?.recipientEmail || process.env.ADMIN_ALERT_EMAIL || process.env.EMAIL_FROM || 'admin@ledgerflow.app';

  const db = options?.dbOverride || getDb();
  
  try {
    const snap = await db.collection('errorLogs')
      .where('createdAt', '>=', cutoffTime)
      .get();

    const rawDocs = snap.docs.map((d: any) => d.data());

    if (rawDocs.length === 0) {
      if (options?.forceSendZero) {
        try {
          const delivery = await sendErrorDigestEmail({
            toEmail: recipient,
            periodHours: hoursBack,
            totalErrors: 0,
            uniqueErrors: 0,
            groups: []
          });
          return {
            processed: true,
            totalErrors: 0,
            uniqueErrors: 0,
            delivered: delivery.delivered,
            recipient,
            provider: delivery.provider,
            groups: []
          };
        } catch (err) {
          return {
            processed: true,
            totalErrors: 0,
            uniqueErrors: 0,
            delivered: false,
            recipient,
            error: errorMessage(err) || String(err),
            groups: []
          };
        }
      }

      return {
        processed: true,
        totalErrors: 0,
        uniqueErrors: 0,
        delivered: false,
        recipient,
        groups: []
      };
    }

    // Group errors by signature
    const { groups, totalErrors, uniqueErrors } = aggregateErrorSignatures(rawDocs);

    let delivered = false;
    let provider: string | undefined;
    let deliveryError: string | undefined;

    try {
      const delivery = await sendErrorDigestEmail({
        toEmail: recipient,
        periodHours: hoursBack,
        totalErrors,
        uniqueErrors,
        groups
      });
      delivered = delivery.delivered;
      provider = delivery.provider;
    } catch (sendErr) {
      deliveryError = errorMessage(sendErr) || String(sendErr);
      console.warn(`[ErrorDigestService] Error digest delivery skipped or failed (${deliveryError}). Digest summary: ${totalErrors} errors across ${uniqueErrors} signatures.`);
    }

    return {
      processed: true,
      totalErrors,
      uniqueErrors,
      delivered,
      recipient,
      provider,
      error: deliveryError,
      groups
    };
  } catch (dbErr) {
    console.error('[ErrorDigestService] Failed to query errorLogs collection:', dbErr);
    return {
      processed: false,
      totalErrors: 0,
      uniqueErrors: 0,
      delivered: false,
      recipient,
      error: errorMessage(dbErr) || String(dbErr),
      groups: []
    };
  }
}
