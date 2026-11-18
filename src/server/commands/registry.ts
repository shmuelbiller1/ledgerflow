import type { z } from 'zod';
import { COMMAND_ROLES, type AnyCommandDefinition, type CommandDefinition } from './types';
import { byCodeUnit } from '../../lib/codeUnitOrder';

const COMMAND_NAME = /^[a-z][a-z0-9]*\.[a-z][a-z0-9]*$/;

/**
 * The command list is partitioned by its leading domain (`invoice`, `journal`, `payment`, …). A
 * handler can resolve one stable dotted name without scanning unrelated areas, while metadata tools
 * can enumerate a single area's commands or the sorted full list.
 */
export class CommandRegistry {
  private readonly areas = new Map<string, Map<string, AnyCommandDefinition>>();

  register<Schema extends z.ZodType, Result, Prepared>(definition: CommandDefinition<Schema, Result, Prepared>): () => void {
    if (!COMMAND_NAME.test(definition.name)) throw new Error(`Invalid command name: ${definition.name}`);
    const [area] = definition.name.split('.');
    if (!definition.roles.length || new Set(definition.roles).size !== definition.roles.length || definition.roles.some(role => !COMMAND_ROLES.includes(role))) {
      throw new Error(`Command ${definition.name} must declare unique, supported roles`);
    }
    if (!definition.describe.sentence.trim() || !definition.describe.example || definition.describe.refusals.length === 0) {
      throw new Error(`Command ${definition.name} needs a sentence, an example, and at least one refusal`);
    }
    if (definition.scope === 'person' && (definition.capacity || definition.dated)) {
      throw new Error(`Command ${definition.name} is person-scoped: it has no workspace for a period lock or plan limit`);
    }
    const existing = this.areas.get(area);
    if (existing?.has(definition.name)) throw new Error(`Duplicate command: ${definition.name}`);
    const commands = existing || new Map<string, AnyCommandDefinition>();
    if (!existing) this.areas.set(area, commands);
    const stored = definition as unknown as AnyCommandDefinition;
    commands.set(definition.name, stored);
    return () => {
      const current = this.areas.get(area);
      if (current?.get(definition.name) === stored) {
        current.delete(definition.name);
        if (current.size === 0) this.areas.delete(area);
      }
    };
  }

  get(name: string): AnyCommandDefinition | undefined {
    const separator = name.indexOf('.');
    if (separator < 1) return undefined;
    return this.areas.get(name.slice(0, separator))?.get(name);
  }

  list(area?: string): AnyCommandDefinition[] {
    const commands = area
      ? [...(this.areas.get(area)?.values() || [])]
      : [...this.areas.values()].flatMap(values => [...values.values()]);
    return commands.sort((a, b) => byCodeUnit(a.name, b.name));
  }

  names(area?: string): string[] {
    return this.list(area).map(command => command.name);
  }

  areaNames(): string[] {
    return [...this.areas.keys()].sort(byCodeUnit);
  }
}
