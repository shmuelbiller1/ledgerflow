import { RecordInlineField } from '../ui/RecordInlineField';
import { ProjectInlineDetails } from './ProjectInlineDetails';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { isPostable, lineAmount } from '../../lib/txFilters';
import React,
 { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Project } from '../../types';
import { cn, formatCurrency } from '../../lib/utils';
import { GripVertical, CheckCircle, Target, Users, PlayCircle, Clock, Archive } from 'lucide-react';

interface ProjectPipelineProps {
  projects: Project[];
  
  onUpdateProject: (id: string, updates: Partial<Project>) => Promise<void>;
}

type PipelineStage = 'planning' | 'in_progress' | 'review' | 'completed' | 'archived';

const STAGES: { id: PipelineStage; label: string; icon: React.ElementType; color: string; borderColor: string }[] = [
  { id: 'planning', label: 'Planning', icon: Target, color: 'bg-slate-100 text-slate-700', borderColor: 'border-[var(--line)]' },
  { id: 'in_progress', label: 'In Progress', icon: PlayCircle, color: 'bg-indigo-100 text-indigo-700', borderColor: 'border-indigo-200' },
  { id: 'review', label: 'Review', icon: Clock, color: 'bg-amber-100 text-amber-700', borderColor: 'border-amber-200' },
  { id: 'completed', label: 'Completed', icon: CheckCircle, color: 'bg-emerald-100 text-emerald-700', borderColor: 'border-emerald-200' },
  { id: 'archived', label: 'Archived', icon: Archive, color: 'bg-stone-100 text-stone-700', borderColor: 'border-stone-200' }
];

export default function ProjectPipeline({ projects, onUpdateProject }: ProjectPipelineProps) {
  const transactions = useLedgerStore(state => state.transactions || []);
  
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    setDraggedProjectId(id);
  };

  const handleDragOver = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    setDragOverStage(stageId);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverStage(null);
  };

  const handleDrop = async (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text');
    setDragOverStage(null);
    setDraggedProjectId(null);

    const proj = projects.find(p => p.id === id);
    if (!proj || proj.pipelineStage === stageId) return;

    let newStatus: Project['status'];
    if (stageId === 'completed') newStatus = 'completed';
    else if (stageId === 'archived') newStatus = 'archived';
    else newStatus = 'active';

    await onUpdateProject(proj.id, { pipelineStage: stageId as PipelineStage, status: newStatus });
  };

  const grouped = useMemo(() => {
    const map: Record<PipelineStage, Project[]> = {
      planning: [],
      in_progress: [],
      review: [],
      completed: [],
      archived: []
    };

    projects.forEach(p => {
      const stage = p.pipelineStage || (p.status === 'completed' ? 'completed' : p.status === 'archived' ? 'archived' : 'planning');
      if (map[stage]) map[stage].push(p);
      else map['planning'].push(p);
    });

    Object.keys(map).forEach(key => {
      map[key as PipelineStage].sort((a, b) => (b.budgetCents || 0) - (a.budgetCents || 0));
    });

    return map;
  }, [projects]);

  const projectStats = useMemo(() => {
    const stats: Record<string, { actualCents: number, budgetCents: number, incomeCents: number, expenseCents: number }> = {};
    
    projects.forEach(p => {
      const projectTransactions = (transactions || []).filter(t => isPostable(t) && t.lines?.some(l => l.project === p.id));
      let income = 0;
      let expense = 0;

      projectTransactions.forEach(t => {
        t.lines?.filter(l => l.project === p.id).forEach(l => {
          const accName = (l.accountName || '').toLowerCase();
          const amt = Math.abs(lineAmount(l, t));
          if (accName.includes('income') || accName.includes('revenue')) {
            income += amt;
          } else if (accName.includes('expense') || accName.includes('cost')) {
            expense += amt;
          }
        });
      });
      
      stats[p.id] = {
        actualCents: income - expense,
        budgetCents: p.budgetCents,
        incomeCents: income,
        expenseCents: expense
      };
    });
    
    return stats;
  }, [projects, transactions]);

  return (
    <div className="flex gap-4 overflow-x-auto min-h-[700px] pb-8 custom-scrollbar pt-6" role="region" aria-label="Project pipeline stages" tabIndex={0}>{/* NOSONAR: S6845 — tabIndex on scrollable region is the intentional axe scrollable-region-focusable pattern */}
      {STAGES.map((stage) => {
        const stageProjects = grouped[stage.id];
        const totalBudget = stageProjects.reduce((sum, p) => sum + (p.budgetCents || 0), 0);
        
        return (
          <div 
            key={stage.id} 
            className={cn(
              "flex-1 min-w-[340px] max-w-[380px] flex flex-col h-full rounded-[32px] border p-4 transition-all duration-300 relative",
              dragOverStage === stage.id ? "bg-slate-100 border-indigo-300 ring-4 ring-indigo-50" : "bg-[var(--ink)]/50 border-[var(--line)]/60"
            )}
            onDragOver={(e) => handleDragOver(e, stage.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, stage.id)}
          >
            {/* Stage Header */}
            <div className="flex items-center justify-between mb-4 px-2">
              <div className="flex items-center gap-3">
                <div className={cn("w-10 h-10 rounded-[32px] flex items-center justify-center border shadow-xs transition-transform hover:scale-105", stage.color, stage.borderColor)}>
                  <stage.icon size={18} className="opacity-90" />
                </div>
                <div>
                  <h2 className="font-bold text-[var(--text)] tracking-tight">{stage.label}</h2>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted)] mt-0.5">{stageProjects.length} Projects</p>
                </div>
              </div>
            </div>

            <div className="px-2 mb-4 space-y-1">
              <div className="flex justify-between items-end">
                <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest">Total Budget</span>
                <span className="font-mono font-black text-[var(--text)] tracking-tighter tabular-nums">{formatCurrency(totalBudget)}</span>
              </div>
            </div>

            {/* Cards Area */}
            <div className="flex-1 space-y-4 relative overflow-y-auto pr-2 custom-scrollbar pb-20">
              <AnimatePresence>
                {stageProjects.map((project) => {
                  const stats = projectStats[project.id];
                  const progress = stats.budgetCents > 0 ? (stats.expenseCents / stats.budgetCents) * 100 : 0;

                  return (
                  <motion.div
                    layout
                    layoutId={project.id}
                    key={project.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e as unknown as React.DragEvent<HTMLDivElement>, project.id!)}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className={cn(
                      "bg-[var(--surface)] border rounded-[32px] p-5 cursor-grab active:cursor-grabbing hover:shadow-xl transition-all group relative overflow-hidden",
                      draggedProjectId === project.id ? "opacity-50 border-slate-300 border-dashed" : "border-[var(--line)]/80 shadow-sm hover:border-slate-300"
                    )}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-1">{project.type}</p>
                        <h3 className="font-black text-[var(--text)] leading-tight"><RecordInlineField collection="projects" record={project} field="name" label={`Name of ${project.name}`} /></h3>
                        <ProjectInlineDetails project={project} />
                      </div>
                      <GripVertical size={14} className="text-slate-300 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity" />
                    </div>

                    <div className="pt-4 border-t border-[var(--line)] space-y-3">
                      <div className="flex items-end justify-between">
                        <div className="space-y-1">
                          <p className="text-[8px] font-bold uppercase tracking-wider text-[var(--muted)]">Budget</p>
                          <p className="text-xs font-bold text-[var(--text)] font-mono tabular-nums">
                            {formatCurrency(stats.budgetCents)}
                          </p>
                        </div>
                        <div className="text-right">
                           <p className="text-[8px] font-bold uppercase tracking-wider text-[var(--muted)]">Spent</p>
                          <span className="text-xs font-black font-mono tracking-tighter text-slate-600 tabular-nums">
                            {formatCurrency(stats.expenseCents)}
                          </span>
                        </div>
                      </div>

                      {/* Progress representation */}
                      <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div 
                          className={cn(
                            "h-full rounded-full transition-all",
                            progress > 100 ? "bg-rose-500" : progress > 75 ? "bg-amber-500" : "bg-emerald-500"
                          )}
                          style={{ width: `${Math.min(progress, 100)}%` }}
                        />
                      </div>
                      <div className="flex justify-between items-center text-[9px] font-medium uppercase tracking-wider text-[var(--muted)]">
                         <span>{progress.toFixed(0)}% Used</span>
                         <div className="flex items-center gap-1"><Users size={10} /> {(project.splitRules || []).length || 1} Mbrs</div>
                      </div>
                    </div>
                  </motion.div>
                )})}
              </AnimatePresence>

              {/* Empty state for the column */}
              {stageProjects.length === 0 && (
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center text-center opacity-40 w-full h-full pointer-events-none">
                   <div className="w-12 h-12 bg-slate-100 rounded-[32px] border-2 border-[var(--line)] border-dashed flex items-center justify-center mb-3">
                     <stage.icon size={20} className="text-[var(--muted)]" />
                   </div>
                   <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">Drop Here</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
