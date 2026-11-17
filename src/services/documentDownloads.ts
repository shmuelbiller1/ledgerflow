import { toast } from 'sonner';
import { getIdToken } from '../firebase';

/** Every document the server can print (documentRoutes.ts PDF_TYPES; BA-08). */
export type PdfDocumentKind = 'invoice' | 'estimate' | 'creditNote' | 'payment' | 'statement' | 'purchaseOrder' | 'bill' | 'vendorCredit' | 'cheque';

async function requestDocumentPdfResponse(
  type: PdfDocumentKind,
  id: string,
  workspaceId: string,
  period?: { startDate?: string; endDate?: string },
  options?: { preview?: boolean }
): Promise<Response> {
  if (!workspaceId) throw new Error('Workspace ID is required to generate PDF');
  if (!id) throw new Error('Document ID is required');

  const token = await getIdToken().catch(() => null);
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const query = new URLSearchParams({ workspaceId });
  if (period?.startDate) query.set('startDate', period.startDate);
  if (period?.endDate) query.set('endDate', period.endDate);
  if (options?.preview) query.set('preview', '1');
  const res = await fetch(`/api/v1/documents/${type}/${encodeURIComponent(id)}/pdf?${query}`, {
    headers
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || `Server returned ${res.status}: Failed to generate document PDF`);
  }

  return res;
}

export async function fetchDocumentPdfBlob(
  type: PdfDocumentKind,
  id: string,
  workspaceId: string,
  period?: { startDate?: string; endDate?: string },
  options?: { preview?: boolean }
): Promise<Blob> {
  const res = await requestDocumentPdfResponse(type, id, workspaceId, period, options);
  return await res.blob();
}

export async function fetchDocumentPdfPreview(
  type: PdfDocumentKind,
  id: string,
  workspaceId: string,
  period?: { startDate?: string; endDate?: string }
): Promise<{ blob: Blob; previewOnly: boolean }> {
  const res = await requestDocumentPdfResponse(type, id, workspaceId, period, { preview: true });
  const previewOnly = res.headers?.get?.('X-Preview-Only') === '1';
  return { blob: await res.blob(), previewOnly };
}

export async function downloadDocumentPdf(
  type: PdfDocumentKind,
  id: string,
  workspaceId: string,
  filename?: string,
  period?: { startDate?: string; endDate?: string }
): Promise<void> {
  const toastId = toast.loading('Generating document PDF...');
  try {
    const blob = await fetchDocumentPdfBlob(type, id, workspaceId, period);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `${type}_${id}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast.success('PDF downloaded successfully', { id: toastId });
  } catch (err) {
    toast.error((err as Error).message || 'Failed to download PDF', { id: toastId });
  }
}

/** Downloads several documents of one kind as PDFs in one zip file (Y-18). */
export async function downloadDocumentsZip(type: Exclude<PdfDocumentKind, 'statement'>, ids: string[], workspaceId: string): Promise<void> {
  const res = await fetch('/api/v1/documents/zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` },
    body: JSON.stringify({ workspaceId, type, ids }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'The PDFs could not be downloaded');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${type}s_${ids.length}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
