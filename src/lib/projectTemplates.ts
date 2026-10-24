/**
 * A-126: Project templates (tasks & budgets).
 *
 * Provides standard built-in project blueprints (with task checklists and whole-cent task budget
 * allocations summing cleanly into `budgetCents`) AND extracts custom reusable workspace templates
 * saved durably inside `Project.metadata.templateSpec`. Every project created from a template
 * receives `budgetCents` and `metadata.tasks` (`ProjectTaskItem[]`) persisted on `projects` (where
 * both `budgetCents` and `metadata` are first-class allowed keys in `lf_rules`).
 */
import type { Project } from '../types';

export interface ProjectTaskItem {
  id: string;
  title: string;
  budgetCents: number;
  done: boolean;
}

export interface ProjectTemplateSpec {
  id: string;
  name: string;
  type: NonNullable<Project['type']>;
  description: string;
  budgetCents: number;
  tasks: Array<{ title: string; budgetCents: number }>;
  builtIn?: boolean;
}

export const BUILT_IN_PROJECT_TEMPLATES: readonly ProjectTemplateSpec[] = [
  {
    id: 'tpl-software-sprint',
    name: 'Client Implementation Sprint',
    type: 'general',
    description: 'Discovery, implementation, QA sign-off, and go-live handover.',
    budgetCents: 1_200_000, // $12,000.00
    builtIn: true,
    tasks: [
      { title: 'Discovery & architecture workshops', budgetCents: 250_000 },
      { title: 'Core implementation & data migration', budgetCents: 650_000 },
      { title: 'QA verification & user training', budgetCents: 300_000 },
    ],
  },
  {
    id: 'tpl-campaign-launch',
    name: 'Product Launch Campaign',
    type: 'campaign',
    description: 'Creative assets, paid acquisition, event production, and attribution reporting.',
    budgetCents: 800_000, // $8,000.00
    builtIn: true,
    tasks: [
      { title: 'Creative & copy production', budgetCents: 200_000 },
      { title: 'Media placement & sponsorships', budgetCents: 450_000 },
      { title: 'Launch webinar & analytics wrap-up', budgetCents: 150_000 },
    ],
  },
  {
    id: 'tpl-book-production',
    name: 'Publication Edition',
    type: 'book',
    description: 'Developmental editing, typesetting, cover design, and print run.',
    budgetCents: 550_000, // $5,500.00
    builtIn: true,
    tasks: [
      { title: 'Developmental & copy editing', budgetCents: 200_000 },
      { title: 'Cover design & interior layout', budgetCents: 150_000 },
      { title: 'Proofing & first print run', budgetCents: 200_000 },
    ],
  },
  {
    id: 'tpl-event-summit',
    name: 'Client Conference / Event',
    type: 'event',
    description: 'Venue deposit, catering & AV staging, travel, and post-event follow-up.',
    budgetCents: 1_500_000, // $15,000.00
    builtIn: true,
    tasks: [
      { title: 'Venue & staging deposit', budgetCents: 600_000 },
      { title: 'Catering & speaker logistics', budgetCents: 650_000 },
      { title: 'Signage, recording & post-event brief', budgetCents: 250_000 },
    ],
  },
];

export function projectTasksFromProject(project?: Pick<Project, 'metadata'> | null): ProjectTaskItem[] {
  const raw = project?.metadata?.tasks;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is Record<string, unknown> => Boolean(t && typeof t === 'object'))
    .map(t => ({
      id: String(t.id || ''),
      title: String(t.title || '').trim(),
      budgetCents: Math.max(0, Math.round(Number(t.budgetCents) || 0)),
      done: Boolean(t.done),
    }))
    .filter(t => t.id && t.title);
}

export function allProjectTemplates(projects: Project[] | undefined): ProjectTemplateSpec[] {
  const custom: ProjectTemplateSpec[] = [];
  for (const p of projects || []) {
    const raw = p.metadata?.templateSpec;
    if (!raw || typeof raw !== 'object') continue;
    const spec = raw as Record<string, unknown>;
    const name = String(spec.name || '').trim();
    if (!name) continue;
    const tasks = Array.isArray(spec.tasks)
      ? spec.tasks
          .filter((t): t is Record<string, unknown> => Boolean(t && typeof t === 'object'))
          .map(t => ({ title: String(t.title || '').trim(), budgetCents: Math.max(0, Math.round(Number(t.budgetCents) || 0)) }))
          .filter(t => t.title)
      : [];
    custom.push({
      id: `custom-${p.id}`,
      name,
      type: (p.type || 'general'),
      description: String(spec.description || p.description || '').trim(),
      budgetCents: Math.max(0, Math.round(Number(spec.budgetCents ?? p.budgetCents) || 0)),
      tasks,
      builtIn: false,
    });
  }
  return [...BUILT_IN_PROJECT_TEMPLATES, ...custom];
}

export function instantiateProjectFromTemplate(
  template: ProjectTemplateSpec,
  projectName?: string,
): Partial<Project> {
  const tasks: ProjectTaskItem[] = template.tasks.map((t, idx) => ({
    id: `task-${idx + 1}-${Math.random().toString(36).slice(2, 8)}`,
    title: t.title,
    budgetCents: Math.max(0, Math.round(t.budgetCents)),
    done: false,
  }));
  const sumTasks = tasks.reduce((s, t) => s + t.budgetCents, 0);
  return {
    name: (projectName || template.name).trim(),
    description: template.description,
    type: template.type,
    status: 'active',
    budgetCents: template.budgetCents > 0 ? template.budgetCents : sumTasks,
    metadata: {
      fromTemplateId: template.id,
      fromTemplateName: template.name,
      tasks,
    },
  };
}

export function saveProjectAsTemplateMetadata(
  project: Pick<Project, 'name' | 'description' | 'budgetCents' | 'metadata'>,
  templateName: string,
): Record<string, unknown> {
  const tasks = projectTasksFromProject(project).map(t => ({ title: t.title, budgetCents: t.budgetCents }));
  return {
    ...(project.metadata || {}),
    templateSpec: {
      name: templateName.trim(),
      description: project.description || '',
      budgetCents: Math.max(0, Math.round(Number(project.budgetCents) || 0)),
      tasks,
    },
  };
}
