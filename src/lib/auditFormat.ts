export interface DisplayAuditLog { details?: string | { description?: unknown } | null; timestamp?: string | number | { toDate(): Date } }
export function auditDescription(log: DisplayAuditLog | null | undefined): string {
  if (!log) return '';
  if (typeof log.details === 'string') return log.details;
  if (log.details && typeof log.details === 'object' && log.details.description) {
    return String(log.details.description);
  }
  return '';
}

export function auditTime(log: DisplayAuditLog | null | undefined): Date | null {
  if (!log || !log.timestamp) return null;
  if (typeof log.timestamp === 'string') {
    const d = new Date(log.timestamp);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof (log.timestamp as { toDate?: unknown }).toDate === 'function') {
    try {
      const d = (log.timestamp as { toDate(): Date }).toDate();
      return Number.isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }
  if (typeof log.timestamp === 'number') {
    const d = new Date(log.timestamp);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
