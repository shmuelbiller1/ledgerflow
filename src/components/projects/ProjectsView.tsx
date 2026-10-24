import { RecordInlineField } from '../ui/RecordInlineField';
import { ProjectInlineDetails } from './ProjectInlineDetails';
import { BrainCircuit, Pencil, Plus, Search, FolderKanban, Trash2, Target, Users, BookOpen, DollarSign, BarChart3, Calendar, LayoutDashboard, List } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, parseAmountToCents, formatCurrency } from '../../lib/utils';
import { isPostable } from '../../lib/txFilters';
import AsyncButton from '../ui/AsyncButton';
import ProjectPipeline from './ProjectPipeline';
import { Labelled } from '../ui/Labelled';
import { EmptyState } from '../ui/EmptyState';
import { LoadingState } from '../ui/LoadingState';
import { projectTasksFromProject } from '../../lib/projectTemplates';
import type { ProjectsModel } from './Projects';

export function ProjectsView({ withOccurrenceKeys, isProjectTx, formId, projects, transactions, loading, onUpdate, searchTerm, setSearchTerm, activeSubTab, setActiveSubTab, isNewProjectModalOpen, setIsNewProjectModalOpen, overlay1DialogProps, overlay1TitleId, editingProject, setEditingProject, overlay2DialogProps, overlay2TitleId, selectedProjectId, setSelectedProjectId, newProject, setNewProject, selectedTemplateId, projectTemplates, handleApplyTemplate, handleToggleProjectTask, handleSaveProjectTemplate, handleAddProject, handleUpdateProject, handleDeleteProject, filteredProjects, projectStats, selectedProject, projectVendors }: ProjectsModel) {
  return (
    <div className="w-full space-y-6 max-w-[1600px] mx-auto pb-12">
      {/* Header with brand gold backdrop */}
      <div className="relative overflow-hidden bg-gradient-to-r from-[var(--brass-soft)] via-[var(--surface)]/40 to-[var(--panel)] p-6 rounded-2xl border border-[var(--brass-line)]/50 shadow-sm">
        <div className="absolute -top-16 -left-16 w-56 h-56 bg-[var(--brass)] opacity-10 rounded-full blur-3xl hidden md:block pointer-events-none" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--brass-soft)] border border-[var(--brass-line)]/60 text-[10px] font-mono text-[var(--brass)] font-semibold mb-2 shadow-xs">
              <FolderKanban aria-hidden="true" size={12} />
              DIMENSIONAL COST ARCHITECTURE
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[var(--text)] tracking-tight">Project & Initiative Tracking</h1>
            <p className="text-xs text-[var(--muted)] font-medium mt-1">Initiative performance management paired with multi-rule split protocol tracing.</p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <div className="flex items-center bg-[var(--surface)]/80 p-1 rounded-xl border border-[var(--line)] shadow-inner backdrop-blur-sm">
              <button
                onClick={() => setActiveSubTab('pipeline')}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all gap-1.5 flex items-center cursor-pointer",
                  activeSubTab === 'pipeline'
                    ? "bg-gradient-to-r from-[var(--brass)] via-[#e5be6b] to-[var(--brass)] text-black font-bold shadow-sm"
                    : "text-[var(--muted)] hover:text-[var(--text)]"
                )}
              >
                 <LayoutDashboard aria-hidden="true" size={13} /> Board
              </button>
              <button
                onClick={() => setActiveSubTab('list')}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all gap-1.5 flex items-center cursor-pointer",
                  activeSubTab === 'list'
                    ? "bg-gradient-to-r from-[var(--brass)] via-[#e5be6b] to-[var(--brass)] text-black font-bold shadow-sm"
                    : "text-[var(--muted)] hover:text-[var(--text)]"
                )}
              >
                <List aria-hidden="true" size={13} /> List
              </button>
            </div>
            <div className="relative group">
              <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] group-focus-within:text-[var(--brass)] transition-colors" size={14} />
              <input
                aria-label="Search projects or tags"
                type="text"
                placeholder="Search projects or tags..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-4 py-2 bg-[var(--surface)] border border-[var(--line)] rounded-xl text-xs focus:outline-none focus:border-[var(--brass-line)] focus:ring-1 focus:ring-[var(--brass)] transition-all w-52 sm:w-60 text-[var(--text)] placeholder:text-[var(--faint)] font-medium"
              />
            </div>
            <button
              onClick={() => setIsNewProjectModalOpen(true)}
              className="h-9 px-4 bg-gradient-to-r from-[var(--brass)] via-[#e5be6b] to-[var(--brass)] text-black hover:opacity-95 rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5 shadow-md hover:shadow-lg cursor-pointer"
            >
              <Plus aria-hidden="true" size={15} />
              Initialize Project
            </button>
          </div>
        </div>
      </div>

      {activeSubTab === 'pipeline' ? (
         <ProjectPipeline
           projects={filteredProjects}
           onUpdateProject={async (id, data) => { if (onUpdate) await onUpdate(id, data); }}
         />
      ) : (
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Project List */}
        <div className="xl:col-span-2 space-y-3">
          {loading && <LoadingState what="projects" />}
          {!loading && filteredProjects.length === 0 && (
            <EmptyState
              title={projects.length ? 'No projects match the search' : 'No projects yet'}
              description={projects.length ? 'Try other words, or clear the search.' : 'A project groups the income and costs of one job or client, with its budget and progress.'}
              actionLabel={projects.length ? 'Clear the search' : 'New project'}
              onAction={projects.length ? () => setSearchTerm('') : () => setIsNewProjectModalOpen(true)}
            />
          )}
          {filteredProjects.map((project) => {
            const stats = projectStats[project.id];
            const progress = stats.budgetCents > 0 ? (stats.expenseCents / stats.budgetCents) * 100 : 0;

            return (
              <motion.div
                key={project.id}
                layoutId={project.id}
                onClick={() => setSelectedProjectId(project.id)}
                className={cn(
                  "p-5 rounded-xl border transition-all cursor-pointer group relative overflow-hidden",
                  selectedProjectId === project.id
                    ? "bg-slate-900 border-slate-950 text-white shadow-xs"
                    : "bg-[var(--surface)] border-[var(--line)]/80 hover:border-slate-300 text-[var(--text)] shadow-3xs"
                )}
              >
                {selectedProjectId === project.id && (
                  <div className="absolute inset-0 technical-grid opacity-10 pointer-events-none" />
                )}

                  <div className="flex items-start justify-between mb-4 relative z-10">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-10 h-10 rounded-lg flex items-center justify-center transition-all",
                        selectedProjectId === project.id ? "bg-[var(--surface)]/10" : "bg-slate-100 border border-[var(--line)]/40"
                      )}>
                        <FolderKanban aria-hidden="true" size={18} className={selectedProjectId === project.id ? "text-orange-300" : "text-slate-600"} />
                      </div>
                      <div dir="auto">
                        <ProjectInlineDetails project={project} />
                        <h2 className="font-bold text-sm tracking-tight"><RecordInlineField collection="projects" record={project} field="name" label={`Name of ${project.name}`} /></h2>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider", selectedProjectId === project.id ? "bg-[var(--surface)]/10 text-white" : "bg-slate-100 text-slate-600")}>
                            {project.type}
                          </span>
                          <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider border", selectedProjectId === project.id ? "border-white/10 text-white/80" : "border-[var(--line)] text-slate-400")}>
                            {project.status}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1 bg-[var(--surface)]/5 p-0.5 rounded-lg border border-slate-250/10">
                        <button
                          aria-label={`Edit project ${project.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingProject(project);
                          }}
                          className={cn(
                            "p-1.5 rounded-md transition-all",
                            selectedProjectId === project.id ? "text-white/80 hover:text-white hover:bg-[var(--surface)]/10" : "text-slate-400 hover:text-[var(--text)] hover:bg-[var(--ink)]"
                          )}
                        >
                          <Pencil aria-hidden="true" size={12} />
                        </button>
                        <AsyncButton
                          aria-label={`Delete project ${project.name}`}
                          onClick={async () => {
                            handleDeleteProject(project.id);
                          }}
                          className={cn(
                            "p-1.5 rounded-md transition-all",
                            selectedProjectId === project.id ? "text-white/80 hover:text-red-400 hover:bg-[var(--surface)]/10" : "text-slate-400 hover:text-rose-600 hover:bg-rose-50/50"
                          )}
                        >
                          <Trash2 aria-hidden="true" size={12} />
                        </AsyncButton>
                      </div>
                      <div className="text-right">
                        <p className={cn("text-[9px] font-bold uppercase tracking-wider mb-0.5", selectedProjectId === project.id ? "text-white/60" : "text-slate-400")}>Net Impact</p>
                        <p className={cn("text-base font-bold font-mono tracking-tight", stats.actualCents < 0 ? (selectedProjectId === project.id ? "text-rose-300" : "font-semibold text-rose-700") : (selectedProjectId === project.id ? "text-emerald-300" : "font-semibold text-emerald-700"))}>
                          {formatCurrency(stats.actualCents)}
                        </p>
                      </div>
                    </div>
                  </div>

                <div className="grid grid-cols-3 gap-4 mb-4 relative z-10 pt-2 border-t border-[var(--line)]/10">
                  <div className="space-y-0.5">
                    <p className={cn("text-[8px] font-bold uppercase tracking-wider", selectedProjectId === project.id ? "text-white/60" : "text-slate-400")}>Allocated</p>
                    <p className="font-semibold font-mono text-xs tabular-nums">{formatCurrency(stats.budgetCents)}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className={cn("text-[8px] font-bold uppercase tracking-wider", selectedProjectId === project.id ? "text-white/60" : "text-slate-400")}>Cost Burn</p>
                    <p className="font-semibold font-mono text-xs tabular-nums">{formatCurrency(stats.expenseCents)}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className={cn("text-[8px] font-bold uppercase tracking-wider", selectedProjectId === project.id ? "text-white/60" : "text-slate-400")}>Usage</p>
                    <p className="font-semibold font-mono text-xs">{progress.toFixed(1)}%</p>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className={cn("h-1 w-full rounded-full overflow-hidden relative z-10", selectedProjectId === project.id ? "bg-[var(--surface)]/10" : "bg-slate-100")}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(progress, 100)}%` }}
                    className={cn(
                      "h-full rounded-full",
                      selectedProjectId === project.id
                        ? "bg-[var(--surface)]"
                        : (progress > 90 ? "bg-rose-500" : progress > 70 ? "bg-amber-500" : "bg-slate-900")
                    )}
                  />
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Project Detail Sidebar */}
        <div className="space-y-4">
          <AnimatePresence mode="wait">
            {selectedProject ? (
              <motion.div
                key={selectedProject.id}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="bg-[var(--surface)] rounded-xl border border-[var(--line)]/80 shadow-3xs p-5 relative overflow-hidden"
              >
                <div className="absolute inset-0 technical-grid opacity-[0.01] pointer-events-none" />
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-4 pb-2 border-b border-[var(--line)]">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--muted)]">Collaborators</h3>
                      <h2 className="text-sm font-black text-[var(--text)] tracking-tight mt-0.5">{selectedProject.name}</h2>
                    </div>
                    <div className="w-8 h-8 bg-[var(--ink)] border border-[var(--line)]/60 rounded-lg flex items-center justify-center">
                      <Users aria-hidden="true" size={14} className="text-[var(--muted)]" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    {projectVendors.length > 0 ? projectVendors.map(vendor => (
                      <div key={vendor.id} className="flex items-center justify-between p-3 bg-[var(--ink)] rounded-xl border border-[var(--line)]/60 hover:border-slate-300 transition-all">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center text-white font-black text-xs shadow-3xs">
                            {vendor.name[0]}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-[var(--text)]">{vendor.name}</p>
                            <p className="text-[8px] text-[var(--muted)] uppercase tracking-wider font-bold">{vendor.type}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-bold font-mono text-[var(--text)] col-span-1 tabular-nums">
                            {formatCurrency(
                              transactions.filter(t =>
                                isPostable(t) && selectedProject && isProjectTx(t, selectedProject) &&
                                (t.metadata?.vendorId === vendor.id || t.payee?.toLowerCase() === vendor.name.toLowerCase())
                              ).reduce((sum, t) => sum + Math.abs(t.totalAmountCents), 0)
                            )}
                          </p>
                          <p className="text-[8px] text-[var(--muted)] uppercase tracking-wider">Settled</p>
                        </div>
                      </div>
                    )) : (
                      <div className="text-center py-10 bg-[var(--ink)]/50 rounded-xl border border-dashed border-[var(--line)]">
                        <div className="w-10 h-10 bg-[var(--ink)] border border-[var(--line)] rounded-lg flex items-center justify-center mx-auto mb-3 opacity-60">
                          <BrainCircuit aria-hidden="true" size={18} className="text-[var(--muted)]" />
                        </div>
                        <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">No active project members</p>
                      </div>
                    )}
                  </div>

                  <div className="mt-5 pt-4 border-t border-[var(--line)]">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-1.5 h-4 bg-[var(--brass)] rounded-full" />
                      <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--text)]">Split Tranches</h2>
                    </div>

                    <div className="space-y-3">
                      {selectedProject.splitRules && withOccurrenceKeys(selectedProject.splitRules, rule => JSON.stringify([rule.partnerId, rule.partnerName, rule.percentage])).map(({ item: rule, key }) => (
                        <div key={key} className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-semibold text-[var(--muted)]">{rule.partnerName}</span>
                            <span className="text-[10px] font-bold font-mono text-[var(--text)]">{rule.percentage}%</span>
                          </div>
                          <div className="h-1 w-full bg-[var(--line)] rounded-full overflow-hidden">
                            <div className="h-full bg-[var(--brass)]" style={{ width: `${rule.percentage}%` }} />
                          </div>
                        </div>
                      ))}
                      {!selectedProject.splitRules?.length && (
                        <p className="text-[10px] text-[var(--muted)] font-bold italic">No split allocations configured.</p>
                      )}
                    </div>
                  </div>

                  {/* A-126: Project Tasks & Save as Template */}
                  <div className="mt-5 pt-4 border-t border-[var(--line)] space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--text)]">Template Tasks &amp; Budgets</h2>
                      <button
                        type="button"
                        onClick={() => handleSaveProjectTemplate(selectedProject)}
                        className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        Save as template
                      </button>
                    </div>
                    {projectTasksFromProject(selectedProject).length === 0 ? (
                      <p className="text-[10px] text-[var(--muted)] italic">No checklist tasks attached to this project.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {projectTasksFromProject(selectedProject).map(task => (
                          <li key={task.id} className="flex items-center justify-between gap-2 text-xs">
                            <label className="inline-flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={task.done}
                                onChange={() => handleToggleProjectTask(selectedProject, task.id)}
                                className="rounded border-slate-300"
                              />
                              <span className={task.done ? 'line-through text-[var(--muted)]' : 'text-[var(--text)]'}>
                                {task.title}
                              </span>
                            </label>
                            <span className="tabular-nums font-mono text-[11px] text-[var(--muted)]">
                              {formatCurrency(task.budgetCents)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="mt-6 pt-4 border-t border-[var(--line)]">
                    <div className="min-w-0 space-y-1"><button className="disabled:cursor-not-allowed disabled:opacity-50 w-full h-10 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold uppercase tracking-wider text-[9px] transition-all flex items-center justify-center gap-2 shadow-3xs cursor-pointer" type="button" disabled aria-describedby="brief-help" title="Project brief generation is not available. Review the project details here." aria-label="Generate Brief">
                      <BarChart3 aria-hidden="true" size={12} className="text-slate-300" />
                      Generate Brief
                    </button>
            <p id="brief-help" className="text-xs text-[var(--muted)] max-w-sm">Project brief generation is not available. Review the project details here.</p></div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="bg-slate-100/30 rounded-xl border border-dashed border-[var(--line)] p-4 md:p-8 text-center h-full flex flex-col items-center justify-center">
                <div className="w-12 h-12 bg-[var(--surface)] rounded-lg shadow-3xs flex items-center justify-center text-[var(--muted)] border border-[var(--line)] mx-auto mb-4">
                  <BrainCircuit aria-hidden="true" size={20} />
                </div>
                <h2 className="text-xs font-bold text-[var(--text)] mb-1 uppercase tracking-wider">Select Initiative</h2>
                <p className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-wider max-w-[200px] mx-auto leading-relaxed">
                  Select a workflow folder from the left pane to analyze members, expenses, and split tranches.
                </p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
      )}

      {/* New Project Modal */}
      {isNewProjectModalOpen && (
        <div {...overlay1DialogProps} className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="w-full max-w-xl bg-[var(--ink)] border border-[var(--line)] rounded-[32px] shadow-2xl overflow-hidden"
          >
            <div className="p-4 md:p-8 border-b border-[var(--line)] flex items-center justify-between">
              <div>
                <h2 id={overlay1TitleId} className="text-xl font-black text-[var(--text)] uppercase italic font-display">Initialize Project</h2>
                <p className="text-[var(--muted)] text-[10px] font-medium uppercase tracking-wider mt-1">Deploying new objective into ledger matrix</p>
              </div>
              <button
                aria-label="Close new project dialog"
                onClick={() => setIsNewProjectModalOpen(false)}
                className="p-2 text-[var(--muted)] hover:text-[var(--text)] transition-colors"
              >
                <Plus aria-hidden="true" size={24} className="rotate-45" />
              </button>
            </div>

            <div className="p-4 md:p-8 space-y-6">
              <div className="space-y-2">
                <Labelled labelClassName="text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.3em] px-1" label="Project Template (Optional)">
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => handleApplyTemplate(e.target.value)}
                    className="w-full p-4 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] text-sm font-bold text-[var(--text)] focus:outline-none focus:border-indigo-600 transition-all"
                  >
                    <option value="">Blank project (no template)</option>
                    {projectTemplates.map(tpl => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name} ({tpl.tasks.length} tasks · {formatCurrency(tpl.budgetCents)})
                      </option>
                    ))}
                  </select>
                </Labelled>
              </div>

              <div className="space-y-2">
                <Labelled labelClassName="text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.3em] px-1" label="Protocol Name">
                  <input
                    type="text"
                    dir="auto"
                    value={newProject.name}
                    onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                    placeholder="e.g., Project Overlord"
                    className="w-full p-4 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] text-sm font-bold focus:outline-none focus:border-indigo-600 transition-all"
                  />
                </Labelled>
              </div>

              <div className="space-y-4">
                <div id={`${formId}-new-type`} className="text-[11px] font-bold text-[var(--muted)] uppercase tracking-widest px-1">Dimensional Type</div>
                <div role="group" aria-labelledby={`${formId}-new-type`} className="grid grid-cols-2 gap-3">
                  {[
                    { id: 'general', label: 'General', icon: FolderKanban },
                    { id: 'book', label: 'Publication', icon: BookOpen },
                    { id: 'event', label: 'Event', icon: Calendar },
                    { id: 'campaign', label: 'Campaign', icon: Target }
                  ].map((type) => (
                    <button
                      key={type.id}
                      aria-pressed={newProject.type === type.id}
                      onClick={() => setNewProject({ ...newProject, type: type.id as unknown as "book" | "event" | "campaign" | "general" | undefined })}
                      className={cn(
                        "flex items-center gap-3 p-4 rounded-[32px] border transition-all text-left",
                        newProject.type === type.id
                          ? "bg-indigo-600 border-indigo-600 text-white shadow-lg"
                          : "bg-[var(--surface)] border-[var(--line)] text-[var(--text)] hover:border-indigo-600/50"
                      )}
                    >
                      <type.icon size={18} />
                      <span className="text-sm font-bold">{type.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Labelled labelClassName="text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.3em] px-1" label="Strategic Description">
                  <textarea
                    dir="auto"
                    value={newProject.description || ''}
                    onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                    placeholder="Intelligence briefing on project goals..."
                    className="w-full p-4 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] text-sm font-medium focus:outline-none focus:border-indigo-600 transition-all h-24"
                  />
                </Labelled>
              </div>
            </div>

            <div className="p-4 md:p-8 bg-[var(--ink)]/30 border-t border-[var(--line)] flex items-center justify-end gap-4">
              <button
                onClick={() => setIsNewProjectModalOpen(false)}
                className="px-6 py-3 text-xs font-medium uppercase tracking-wider text-[var(--muted)] hover:text-[var(--text)] transition-colors"
              >
                Cancel
              </button>
              <AsyncButton
                onClick={handleAddProject}
                disabled={!newProject.name}
                loadingText="PROCESSING..."
                className="px-8 py-3 bg-indigo-600 text-white rounded-[32px] text-xs font-medium uppercase tracking-wider hover:bg-indigo-600/90 transition-all shadow-xl disabled:opacity-50"
              >
                INITIALIZE PROTOCOL
              </AsyncButton>
            </div>
          </motion.div>
        </div>
      )}

      {/* Edit Project Modal */}
      {editingProject && (
        <div {...overlay2DialogProps} className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="w-full max-w-xl bg-[var(--ink)] border border-[var(--line)] rounded-[32px] shadow-2xl overflow-hidden"
          >
            <div className="p-4 md:p-8 border-b border-[var(--line)] flex items-center justify-between">
              <div>
                <h2 id={overlay2TitleId} className="text-xl font-black text-[var(--text)] uppercase italic font-display">Configure Project</h2>
                <p className="text-[var(--muted)] text-[10px] font-medium uppercase tracking-wider mt-1">Rule settings for project matrix {editingProject.id.slice(0, 8)}</p>
              </div>
              <button
                aria-label="Close project configuration dialog"
                onClick={() => setEditingProject(null)}
                className="p-2 text-[var(--muted)] hover:text-[var(--text)] transition-colors"
              >
                <Plus aria-hidden="true" size={24} className="rotate-45" />
              </button>
            </div>

            <div className="p-4 md:p-8 space-y-6">
              <div className="space-y-2">
                <Labelled labelClassName="text-[11px] font-bold text-[var(--muted)] uppercase tracking-widest px-1" label="Protocol Name">
                  <input
                    type="text"
                    dir="auto"
                    value={editingProject.name}
                    onChange={(e) => setEditingProject({ ...editingProject, name: e.target.value })}
                    className="w-full p-4 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] text-sm font-bold focus:outline-none focus:border-indigo-600 transition-all"
                  />
                </Labelled>
              </div>

              <div className="space-y-4">
                <div id={`${formId}-status`} className="text-[11px] font-bold text-[var(--muted)] uppercase tracking-widest px-1">Status</div>
                <div role="group" aria-labelledby={`${formId}-status`} className="grid grid-cols-3 gap-3">
                  {[
                    { id: 'active', label: 'Active', color: 'ledger-success' },
                    { id: 'completed', label: 'Done', color: 'ledger-accent' },
                    { id: 'archived', label: 'Archived', color: 'ledger-muted' }
                  ].map((status) => (
                    <button
                      key={status.id}
                      aria-pressed={editingProject.status === status.id}
                      onClick={() => setEditingProject({ ...editingProject, status: status.id as unknown as "completed" | "archived" | "active" })}
                      className={cn(
                        "p-3 rounded-[32px] border transition-all text-xs font-bold uppercase tracking-wider",
                        editingProject.status === status.id
                          ? `bg-${status.color} border-${status.color} text-white shadow-lg`
                          : "bg-[var(--surface)] border-[var(--line)] text-[var(--muted)] hover:border-indigo-600/50"
                      )}
                    >
                      {status.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div id={`${formId}-edit-type`} className="text-[11px] font-bold text-[var(--muted)] uppercase tracking-widest px-1">Dimensional Type</div>
                <div role="group" aria-labelledby={`${formId}-edit-type`} className="grid grid-cols-2 gap-3">
                    {[
                      { id: 'general', label: 'General', icon: FolderKanban },
                      { id: 'book', label: 'Publication', icon: BookOpen },
                      { id: 'event', label: 'Event', icon: Calendar },
                      { id: 'campaign', label: 'Campaign', icon: Target }
                    ].map((type) => (
                      <button
                        key={type.id}
                        aria-pressed={editingProject.type === type.id}
                        onClick={() => setEditingProject({ ...editingProject, type: type.id as unknown as "book" | "event" | "campaign" | "general" })}
                        className={cn(
                          "flex items-center gap-3 p-4 rounded-[32px] border transition-all text-left",
                          editingProject.type === type.id
                            ? "bg-indigo-600 border-indigo-600 text-white shadow-lg"
                            : "bg-[var(--surface)] border-[var(--line)] text-[var(--text)] hover:border-indigo-600/50"
                        )}
                      >
                        <type.icon size={18} />
                        <span className="text-sm font-bold">{type.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label htmlFor={`${formId}-budget`} className="text-[11px] font-bold text-[var(--muted)] uppercase tracking-widest px-1">Budget Allocation</label>
                  <div className="relative">
                    <DollarSign aria-hidden="true" size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                    <input
                      id={`${formId}-budget`}
                      type="number"
                      value={editingProject.budgetCents / 100}
                      onChange={(e) => setEditingProject({ ...editingProject, budgetCents: parseAmountToCents(e.target.value) })}
                      className="w-full pl-10 pr-4 py-4 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] text-sm font-bold focus:outline-none focus:border-indigo-600 transition-all"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Labelled labelClassName="text-[11px] font-bold text-[var(--muted)] uppercase tracking-widest px-1" label="Strategic Description">
                  <textarea
                    dir="auto"
                    value={editingProject.description || ''}
                    onChange={(e) => setEditingProject({ ...editingProject, description: e.target.value })}
                    className="w-full p-4 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] text-sm font-medium focus:outline-none focus:border-indigo-600 transition-all h-24"
                  />
                </Labelled>
              </div>
            </div>

            <div className="p-4 md:p-8 bg-[var(--ink)]/30 border-t border-[var(--line)] flex items-center justify-end gap-4">
              <button
                onClick={() => setEditingProject(null)}
                className="px-6 py-3 text-xs font-medium uppercase tracking-wider text-[var(--muted)] hover:text-[var(--text)] transition-colors"
              >
                Cancel
              </button>
              <AsyncButton
                onClick={handleUpdateProject}
                disabled={!editingProject.name}
                loadingText="COMMITTING..."
                className="px-8 py-3 bg-indigo-600 text-white rounded-[32px] text-xs font-medium uppercase tracking-wider hover:bg-indigo-600/90 transition-all shadow-xl disabled:opacity-50"
              >
                SAVE MODIFICATIONS
              </AsyncButton>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
