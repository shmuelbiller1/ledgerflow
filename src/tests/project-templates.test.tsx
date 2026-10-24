import './helpers/dom';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allProjectTemplates,
  BUILT_IN_PROJECT_TEMPLATES,
  instantiateProjectFromTemplate,
  projectTasksFromProject,
  saveProjectAsTemplateMetadata,
} from '../lib/projectTemplates';

describe('A-126 project templates (tasks & budgets)', () => {
  test('instantiates built-in templates with whole-cent budgets and round-trips custom workspace templates', () => {
    const sprint = BUILT_IN_PROJECT_TEMPLATES[0];
    const created = instantiateProjectFromTemplate(sprint, 'Acme Onboarding');
    assert.equal(created.name, 'Acme Onboarding');
    assert.equal(created.budgetCents, 1_200_000);
    const tasks = projectTasksFromProject(created);
    assert.equal(tasks.length, 3);
    assert.equal(tasks.reduce((s, t) => s + t.budgetCents, 0), 1_200_000);

    const savedMeta = saveProjectAsTemplateMetadata(
      { name: 'Acme Onboarding', description: created.description, budgetCents: 1_200_000, metadata: created.metadata },
      'Reusable Onboarding Blueprint',
    );
    const merged = allProjectTemplates([
      {
        id: 'p1',
        uid: 'u1',
        workspaceId: 'ws1',
        name: 'Acme Onboarding',
        type: 'general',
        status: 'active',
        budgetCents: 1_200_000,
        dimensions: [],
        metadata: savedMeta,
        createdAt: '2026-10-01',
      },
    ]);
    assert.ok(merged.some(t => t.name === 'Reusable Onboarding Blueprint' && t.budgetCents === 1_200_000));
  });
});
