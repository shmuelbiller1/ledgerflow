import type { Workbook, Worksheet, CellValue } from 'exceljs';
import { useAuthStore } from '../stores/useAuthStore';

export interface ExcelColumn {
  header: string;
  key: string;
  width?: number;
}

export interface ReportExportContext {
  title: string;
  entity: string;
  period: string;
  basis: string;
  currency: string;
  generatedAt: string;
}

export interface ExportToExcelOptions {
  sheetName?: string;
  fileName?: string;
  titleRows?: CellValue[][];
  /** C-87: when set, builds the same header block for every report export. */
  reportContext?: ReportExportContext;
}

/**
 * A formula-like cell is written as rich text, not as a formula or an altered label. ExcelJS treats
 * plain strings beginning with `=`, `+`, `-` or `@` as formulas; rich text keeps the exact value.
 */
function reportHeaderCell(value: string): CellValue {
  return /^[=+\-@]/.test(value) ? { richText: [{ text: value }] } : value;
}

/** The one header block (C-87): report, entity, period, basis, currency and when it was made. */
export function reportTitleRows(context: ReportExportContext): CellValue[][] {
  return [
    [reportHeaderCell(context.title)],
    [reportHeaderCell(`Entity: ${context.entity}`)],
    [reportHeaderCell(`Period: ${context.period}`)],
    [reportHeaderCell(`Basis: ${context.basis}`)],
    [reportHeaderCell(`Currency: ${context.currency}`)],
    [reportHeaderCell(`Generated at: ${context.generatedAt}`)],
    [],
  ];
}

/** Reads the signed-in workspace's own name and currency; no report row or amount is stored. */
export function currentReportExportContext(
  title: string,
  period: string,
  basis: string,
  generatedAt = new Date().toISOString(),
): ReportExportContext {
  const state = useAuthStore.getState();
  const workspace = state.workspaces.find(row => row.id === state.currentWorkspaceId);
  return {
    title,
    entity: workspace?.name || 'Current workspace',
    period,
    basis,
    currency: workspace?.currency || 'USD',
    generatedAt,
  };
}

/**
 * Creates a raw initialized ExcelJS workbook.
 */
export async function createWorkbook(): Promise<Workbook> {
  // Vite and Node expose CommonJS interop differently; both module shapes carry the same ctor.
  const ExcelJS = await import('exceljs') as unknown as {
    Workbook?: new () => Workbook;
    default?: { Workbook: new () => Workbook };
  };
  const WorkbookClass = ExcelJS.Workbook || ExcelJS.default?.Workbook;
  if (!WorkbookClass) throw new Error('Excel workbook library is unavailable');
  return new WorkbookClass();
}

/**
 * Downloads an ExcelJS workbook in the browser environment.
 */
export async function downloadWorkbook(workbook: Workbook, fileName: string): Promise<void> {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as unknown as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
  });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

/**
 * Creates an initialized ExcelJS workbook and worksheet with columns configured.
 */
export async function createStyledWorkbook(
  sheetName: string,
  columns: ExcelColumn[]
): Promise<{ workbook: Workbook; worksheet: Worksheet }> {
  const workbook = await createWorkbook();
  const worksheet = workbook.addWorksheet(sheetName);
  worksheet.columns = columns.map(c => ({
    header: c.header,
    key: c.key,
    width: c.width || 20
  }));
  return { workbook, worksheet };
}

/**
 * Builds a report workbook with title rows *above* the column headings. Object rows still resolve
 * through the declared column keys; array rows preserve their order.
 */
export async function buildReportWorkbook(
  columns: ExcelColumn[],
  rows: (Record<string, unknown> | (string | number | null | undefined)[])[],
  options?: ExportToExcelOptions,
): Promise<Workbook> {
  const workbook = await createWorkbook();
  const worksheet = workbook.addWorksheet(options?.sheetName || 'Report');
  worksheet.columns = columns.map(column => ({ key: column.key, width: column.width || 20 }));
  const titleRows = options?.titleRows?.length
    ? options.titleRows
    : options?.reportContext
      ? reportTitleRows(options.reportContext)
      : [];
  for (const titleRow of titleRows) worksheet.addRow(titleRow);
  worksheet.addRow(columns.map(column => column.header));
  for (const row of rows) worksheet.addRow(row);
  return workbook;
}

function excelDateISO(d: Date): string {
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function extractRichText(value: unknown): string {
  if (!value || typeof value !== 'object' || !('richText' in value) || !Array.isArray((value as { richText?: unknown }).richText)) {
    return '';
  }
  return (value as { richText: Array<{ text?: unknown }> }).richText
    .map(part => (typeof part?.text === 'string' ? part.text : ''))
    .join('');
}

export function extractExcelCellValue(raw: unknown): CellValue {
  let val = raw;
  if (val && typeof val === 'object' && !(val instanceof Date)) {
    if ('result' in val) {
      val = (val as { result?: unknown }).result;
    } else if ('formula' in val || 'sharedFormula' in val) {
      return '';
    }
  }
  if (val === null || val === undefined) return '';
  if (typeof val === 'boolean' || typeof val === 'number' || typeof val === 'string') return val;
  if (val instanceof Date) return excelDateISO(val);
  if (typeof val === 'object') {
    if ('error' in val && typeof (val as { error?: unknown }).error === 'string') {
      return (val as { error: string }).error;
    }
    if ('richText' in val) {
      return extractRichText(val);
    }
    if ('hyperlink' in val) {
      const link = val as { text?: unknown; hyperlink?: unknown };
      if (typeof link.text === 'string') return link.text;
      if (link.text && typeof link.text === 'object' && 'richText' in link.text) {
        return extractRichText(link.text);
      }
      return typeof link.hyperlink === 'string' ? link.hyperlink : '';
    }
  }
  return String(val);
}

/**
 * Reads 2D rows from an Excel file ArrayBuffer.
 */
export async function parseExcelToRows(data: ArrayBuffer): Promise<CellValue[][]> {
  const workbook = await createWorkbook();
  await workbook.xlsx.load(data);
  const worksheet = workbook.worksheets[0];
  const rows: CellValue[][] = [];
  if (worksheet) {
    worksheet.eachRow((row) => {
      const rowData: CellValue[] = [];
      if (Array.isArray(row.values)) {
        // row.values is 1-indexed in ExcelJS
        for (let i = 1; i < row.values.length; i++) {
          rowData.push(extractExcelCellValue(row.values[i]));
        }
      }
      rows.push(rowData);
    });
  }
  return rows;
}

/**
 * One-shot export helper: creates workbook, populates title rows, columns, data rows, and triggers download.
 */
export async function exportToExcel(
  columns: ExcelColumn[],
  rows: (Record<string, unknown> | (string | number | null | undefined)[])[],
  options?: ExportToExcelOptions
): Promise<void> {
  const sheetName = options?.sheetName || 'Report';
  const fileName = options?.fileName || `${sheetName.replace(/\s+/g, '_')}_export.xlsx`;
  const workbook = await buildReportWorkbook(columns, rows, { ...options, sheetName });
  await downloadWorkbook(workbook, fileName);
}
