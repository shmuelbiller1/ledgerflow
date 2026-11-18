import { fill, useReportText } from './useReportText';
import { useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { exportTemplateKey, MAX_EXPORT_TEMPLATES, parseExportTemplates, templateMatches } from '../../lib/exportTemplates';
import type { ExportTemplate } from '../../lib/exportTemplates';
import { validPeriodLayout, type ReportPeriodLayout } from '../../lib/reportPeriodLayout';

export default function ExportTemplateControls(props: { report: string; columns: string[]; layout: ReportPeriodLayout; onUse: (layout: ReportPeriodLayout) => void }) {
  const user = useAuthStore(state => state.user?.uid || 'guest');
  const workspace = useAuthStore(state => state.currentWorkspaceId || 'none');
  const storageKey = exportTemplateKey(user, workspace, props.report);
  return <ScopedTemplates key={JSON.stringify([storageKey, props.columns])} {...props} storageKey={storageKey} user={user} workspace={workspace} />;
}
function ScopedTemplates({ report, columns, layout, onUse, storageKey, user, workspace }: { report: string; columns: string[]; layout: ReportPeriodLayout; onUse: (layout: ReportPeriodLayout) => void; storageKey: string; user: string; workspace: string }) {
  const reportText = useReportText();
  const [templates, setTemplates] = useState(() => { try { return parseExportTemplates(localStorage.getItem(storageKey)); } catch { return []; } });
  const [name, setName] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const current = () => (useAuthStore.getState().user?.uid || 'guest') === user && (useAuthStore.getState().currentWorkspaceId || 'none') === workspace;
  function persist(next: ExportTemplate[]) {
    if (!current()) return;
    setTemplates(next); setError('');
    try { localStorage.setItem(storageKey, JSON.stringify({ version: 1, templates: next })); }
    catch { setError(reportText('r.template-storage', 'Browser storage is unavailable. Template changes last until this screen reloads.')); }
  }
  function save() {
    if (!current()) return;
    const label = name.trim();
    if (!label || label.length > 80) { setError(reportText('r.template-name-length', 'Enter a template name of 1–80 characters.')); return; }
    if (templates.some(template => template.name === label)) { setError(reportText('r.template-duplicate', 'That name already exists. Choose another name or remove the old template first.')); return; }
    if (templates.length >= MAX_EXPORT_TEMPLATES) { setError(fill(reportText('r.template-limit', 'Up to {count} templates per report. Remove one first.'), { count: MAX_EXPORT_TEMPLATES })); return; }
    persist([...templates, { name: label, columns: [...columns], layout: validPeriodLayout(layout, columns.map((_, index) => String(index))) }]);
    setNotice(fill(reportText('r.template-saved', 'Saved {name}'), { name: label })); setName('');
  }
  return <details data-print-hide className="min-w-0 rounded border p-2">
    <summary className="min-h-11 cursor-pointer">{reportText('r.export-templates', 'Export templates')}</summary>
    <p className="text-xs">{fill(reportText('r.template-help', 'Named column choices for {report}, saved for you in this workspace on this device. Use a template, then export CSV. Dates, filters and report data are not stored.'), { report })}</p>
    <div className="flex flex-wrap gap-2 mt-2"><label className="min-w-0 text-sm">{reportText('r.template-name', 'Template name')}<input value={name} onChange={event => setName(event.target.value)} maxLength={80} className="block min-h-11 max-w-full border rounded px-2" /></label><button type="button" onClick={save} className="min-h-11 border rounded px-3">{reportText('r.save-template', 'Save these columns as…')}</button></div>
    {templates.length === 0 && <p className="text-xs">{reportText('r.no-templates', 'No saved templates yet.')}</p>}
    <ul>{templates.map(template => { const compatible = templateMatches(template, columns); return <li key={template.name} className="flex flex-wrap items-center gap-2 mt-2"><bdi dir="auto" className="break-words">{template.name}</bdi><button type="button" disabled={!compatible} onClick={() => { if (current() && compatible) { onUse(template.layout); setNotice(fill(reportText('r.template-used', 'Using {name}'), { name: template.name })); } }} aria-label={fill(reportText('r.use-template', 'Use template {name}'), { name: template.name })} className="min-h-11 border rounded px-3">{reportText('r.template-use', 'Use')}</button><button type="button" onClick={() => persist(templates.filter(item => item.name !== template.name))} aria-label={fill(reportText('r.remove-template', 'Remove template {name}'), { name: template.name })} className="min-h-11 border rounded px-3">{reportText('r.template-remove', 'Remove')}</button>{!compatible && <span className="text-xs">{reportText('r.template-changed', 'Columns have changed; this template cannot be applied here.')}</span>}</li>; })}</ul>
    {error && <p role="alert" className="text-sm">{error}</p>}<p role="status" className="sr-only">{notice}</p>
  </details>;
}
