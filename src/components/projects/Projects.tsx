import { deleteProjectWithUndo } from '../../lib/projectUndo';
import { useDialog } from '../../hooks/useDialog';
import { useState, useMemo, useId } from 'react';
import { Project, Transaction } from '../../types';

import { safeConfirm } from '../../lib/utils';
import { resolveAccountRole } from '../../lib/accountUtils';
import { isPostable, lineAmount } from '../../lib/txFilters';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useCommandDispatcher } from '../../hooks/useSystemContext';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import {
  allProjectTemplates,
  instantiateProjectFromTemplate,
  projectTasksFromProject,
  saveProjectAsTemplateMetadata,
} from '../../lib/projectTemplates';
import { ProjectsView } from './ProjectsView';
function withOccurrenceKeys<T>(items: T[], keyForItem: (item: T) => string) {
  const occurrences = new Map<string, number>();
  return items.map(item => {
    const contentKey = keyForItem(item);
    const occurrence = occurrences.get(contentKey) ?? 0;
    occurrences.set(contentKey, occurrence + 1);
    return { item, key: JSON.stringify([contentKey, occurrence]) };
  });
}

const isProjectLine = (l: import("../../types").TransactionLine, p: Project) => {
    if (!l || !p) return false;
    return l.project === p.id ||
           l.project === p.name ||
           l.dimensions?.project === p.id ||
           l.dimensions?.project === p.name;
  };

const isProjectTx = (t: Transaction, p: Project) => {
    if (!t || !p) return false;
    return t.projectId === p.id ||
           t.project === p.id ||
           t.project === p.name ||
           (t.lines && t.lines.some(l => isProjectLine(l, p)));
  };

function useProjectsModel() {
  const formId = useId();
  const user = useAuthStore(s => s.user);
  const projects = useLedgerStore(s => s.projects);
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const bills = useLedgerStore(s => s.bills);
  useLedgerStore(s => s.budgets);
  const vendors = useLedgerStore(s => s.vendors);
  const { loading } = useLedgerCollections('bills', 'budgets', 'vendors');
  useCommandDispatcher();
  const { addEntity, updateEntity } = useEntityOperations();
  const onAdd = (data: Partial<Project>) => addEntity('projects', data);
  const onUpdate = (id: string, data: Partial<Project>) => updateEntity('projects', id, data);
  const onDelete = (id: string) => deleteProjectWithUndo(id);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSubTab, setActiveSubTab] = useState<'pipeline' | 'list'>('pipeline');
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const { dialogProps: overlay1DialogProps, titleId: overlay1TitleId } = useDialog(() => setIsNewProjectModalOpen(false), isNewProjectModalOpen);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const { dialogProps: overlay2DialogProps, titleId: overlay2TitleId } = useDialog(() => setEditingProject(null), !!editingProject);
  const [_saving, setSaving] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const [newProject, setNewProject] = useState<Partial<Project>>({
    name: '',
    description: '',
    type: 'general',
    status: 'active',
    budgetCents: 0
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const projectTemplates = useMemo(() => allProjectTemplates(projects), [projects]);

  const handleApplyTemplate = (tplId: string) => {
    setSelectedTemplateId(tplId);
    const tpl = projectTemplates.find(t => t.id === tplId);
    if (!tpl) return;
    setNewProject(prev => ({
      ...instantiateProjectFromTemplate(tpl, prev.name?.trim() ? prev.name : tpl.name),
    }));
  };

  const handleToggleProjectTask = async (project: Project, taskId: string) => {
    const updatedTasks = projectTasksFromProject(project).map(t =>
      t.id === taskId ? { ...t, done: !t.done } : t);
    await onUpdate(project.id, {
      metadata: { ...(project.metadata || {}), tasks: updatedTasks },
    });
  };

  const handleSaveProjectTemplate = async (project: Project) => {
    const nextMetadata = saveProjectAsTemplateMetadata(project, `${project.name} Template`);
    await onUpdate(project.id, { metadata: nextMetadata });
    toast.success(`Saved "${project.name} Template" for future projects`);
  };

  const handleAddProject = async () => {
    if (!newProject.name || !onAdd) return;
    setSaving(true);
    try {
      await onAdd({
        ...newProject,
        uid: user?.uid || "",
        createdAt: new Date().toISOString()
      });
      setIsNewProjectModalOpen(false);
      setNewProject({
        name: '',
        description: '',
        type: 'general',
        status: 'active',
        budgetCents: 0
      });
      toast.success('Project initialized successfully');
    } catch {
      toast.error('Failed to initialize project');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateProject = async () => {
    if (!editingProject || !onUpdate) return;
    setSaving(true);
    try {
      await onUpdate(editingProject.id, editingProject);
      setEditingProject(null);
      toast.success('Project updated successfully');
    } catch {
      toast.error('Failed to update project');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (!onDelete) return;
    const project = projects.find(p => p.id === id);
    if (!project) return;

    const referencingTxs = transactions.filter(t => isProjectTx(t, project));
    const referencingBills = (bills || []).filter(b => b.projectId === id || b.metadata?.projectId === id);

    let confirmMsg = 'Are you sure you want to delete this project?';
    if (referencingTxs.length > 0 || referencingBills.length > 0) {
      confirmMsg = `Warning: ${referencingTxs.length} transaction(s) and ${referencingBills.length} bill(s) reference "${project.name}". Deleting this project will unlink these financial records. Do you still wish to proceed?`;
    }

    if (!safeConfirm(confirmMsg)) return;
    try {
      await onDelete(id);
      if (selectedProjectId === id) setSelectedProjectId(null);
    } catch {
      toast.error('Deletion failed');
    }
  };

  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      const term = searchTerm.toLowerCase();
      if (!term) return true;
      const searchStr = `${p.name || ''} ${p.description || ''} ${p.tags?.join(' ') || ''} ${p.metadata ? JSON.stringify(p.metadata) : ''}`.toLowerCase();
      return searchStr.includes(term);
    });
  }, [projects, searchTerm]);

  const projectStats = useMemo(() => {
    const stats: Record<string, { actualCents: number, budgetCents: number, incomeCents: number, expenseCents: number }> = {};
    const accountsMap = new Map(accounts.map(a => [a.id, a]));

    projects.forEach(p => {
      const projectTransactions = transactions.filter(t => isPostable(t) && isProjectTx(t, p));
      let income = 0;
      let expense = 0;

      projectTransactions.forEach(t => {
        const matchingLines = t.lines?.filter(l => isProjectLine(l, p) || t.projectId === p.id) || [];
        matchingLines.forEach(l => {
          const acc = accountsMap.get(l.accountId);
          const role = resolveAccountRole(acc);
          const accName = (l.accountName || acc?.name || '').toLowerCase();
          const amt = lineAmount(l, t);

          if (role === 'revenue' || acc?.type === 'income' || acc?.type === 'revenue') {
            // Revenue in double-entry is negative (credit)
            income += amt < 0 ? -amt : amt;
          } else if (role === 'expense' || role === 'cogs' || acc?.type === 'expense' || acc?.type === 'cost_of_goods') {
            // Expense in double-entry is positive (debit)
            expense += amt > 0 ? amt : -amt;
          } else if (accName.includes('income') || accName.includes('revenue') || accName.includes('sales')) {
            income += Math.abs(amt);
          } else if (accName.includes('expense') || accName.includes('cost') || accName.includes('cogs')) {
            expense += Math.abs(amt);
          }
        });
      });

      stats[p.id] = {
        actualCents: income - expense,
        budgetCents: p.budgetCents || 0,
        incomeCents: income,
        expenseCents: expense
      };
    });

    return stats;
  }, [projects, transactions, accounts]);

  const selectedProject = useMemo(() =>
    projects.find(p => p.id === selectedProjectId),
  [projects, selectedProjectId]);

  const projectVendors = useMemo(() => {
    if (!selectedProjectId) return [];
    const selectedP = projects.find(p => p.id === selectedProjectId);
    if (!selectedP) return [];

    const vendorIds = new Set<string>();

    transactions.forEach(t => {
      if (isProjectTx(t, selectedP)) {
        if (t.metadata?.vendorId) {
          vendorIds.add(t.metadata.vendorId);
        }
        if (t.payee) {
          const matched = vendors.find(v => v.name.toLowerCase() === t.payee?.toLowerCase());
          if (matched) vendorIds.add(matched.id);
        }
      }
    });

    (bills || []).forEach(b => {
      if (b.projectId === selectedProjectId || b.metadata?.projectId === selectedProjectId) {
        if (b.vendorId) vendorIds.add(b.vendorId);
      }
    });

    return vendors.filter(v => vendorIds.has(v.id));
  }, [selectedProjectId, projects, transactions, bills, vendors]);

  return { withOccurrenceKeys, isProjectTx, formId, projects, transactions, loading, onUpdate, searchTerm, setSearchTerm, activeSubTab, setActiveSubTab, isNewProjectModalOpen, setIsNewProjectModalOpen, overlay1DialogProps, overlay1TitleId, editingProject, setEditingProject, overlay2DialogProps, overlay2TitleId, selectedProjectId, setSelectedProjectId, newProject, setNewProject, selectedTemplateId, projectTemplates, handleApplyTemplate, handleToggleProjectTask, handleSaveProjectTemplate, handleAddProject, handleUpdateProject, handleDeleteProject, filteredProjects, projectStats, selectedProject, projectVendors };
}

export type ProjectsModel = NonNullable<ReturnType<typeof useProjectsModel>>;

export default function Projects() {
  const model = useProjectsModel();
  return <ProjectsView {...model} />;
}
