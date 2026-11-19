import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { byCodeUnit } from '../src/lib/codeUnitOrder';
import { commandRegistry } from '../src/server/commands/defaultRegistry';
import { renderAssistantTools } from '../src/server/services/assistantToolDefinitions';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type SharedFragment = { key: string; value: unknown; localName: string; propertyName: string };
type SharedFragments = { byKey: Map<string, SharedFragment>; entries: SharedFragment[] };

function safeJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort(byCodeUnit)
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function renderCompactLiteral(
  value: unknown,
  fragments: SharedFragments,
  mode: 'local' | 'shared',
  skipReference?: string,
): string | undefined {
  const key = Array.isArray(value) || isRecord(value) ? canonicalJson(value) : undefined;
  const fragment = key ? fragments.byKey.get(key) : undefined;
  if (fragment && key !== skipReference) {
    return mode === 'local' ? fragment.localName : `COMMAND_SCHEMA_PARTS.${fragment.propertyName}`;
  }
  if (Array.isArray(value)) {
    const items = value.map(item => renderCompactLiteral(item, fragments, mode));
    return items.some(item => item === undefined) ? undefined : `[${items.join(', ')}]`;
  }
  if (isRecord(value)) {
    const properties = Object.entries(value).map(([property, child]) => {
      const rendered = renderCompactLiteral(child, fragments, mode);
      return rendered === undefined ? undefined : `${safeJson(property)}: ${rendered}`;
    });
    return properties.some(property => property === undefined) ? undefined : `{ ${properties.join(', ')} }`;
  }
  return safeJson(value);
}

function sharedFragments(values: unknown[]): SharedFragments {
  const occurrences = new Map<string, { value: unknown; count: number }>();
  const visit = (value: unknown) => {
    if (Array.isArray(value) || isRecord(value)) {
      const key = canonicalJson(value);
      const found = occurrences.get(key);
      if (found) found.count++;
      else occurrences.set(key, { value, count: 1 });
      if (Array.isArray(value)) value.forEach(visit);
      else Object.values(value).forEach(visit);
    }
  };
  values.forEach(visit);
  const entries = [...occurrences.entries()]
    .filter(([, fragment]) => fragment.count > 1)
    .sort(([left], [right]) => left.length - right.length || byCodeUnit(left, right))
    .map(([key, fragment], index) => ({
      key,
      value: fragment.value,
      localName: `schemaPart${index}`,
      propertyName: `part${index}`,
    }));
  return { entries, byKey: new Map(entries.map(entry => [entry.key, entry])) };
}

function renderLiteral(
  value: unknown,
  fragments: SharedFragments,
  mode: 'local' | 'shared',
  skipReference?: string,
  depth = 0,
  compact = false,
): string {
  const key = Array.isArray(value) || isRecord(value) ? canonicalJson(value) : undefined;
  const fragment = key ? fragments.byKey.get(key) : undefined;
  if (fragment && key !== skipReference) {
    return mode === 'local' ? fragment.localName : `COMMAND_SCHEMA_PARTS.${fragment.propertyName}`;
  }
  if (compact) {
    const compactLiteral = renderCompactLiteral(value, fragments, mode, skipReference);
    if (compactLiteral !== undefined && compactLiteral.length <= 80) return compactLiteral;
  }

  const indent = '  '.repeat(depth);
  const childIndent = '  '.repeat(depth + 1);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return `[\n${value.map(item => `${childIndent}${renderLiteral(item, fragments, mode, undefined, depth + 1, compact)}`).join(',\n')}\n${indent}]`;
  }
  if (isRecord(value)) {
    const properties = Object.entries(value);
    if (!properties.length) return '{}';
    return `{\n${properties.map(([property, child]) =>
      `${childIndent}${safeJson(property)}: ${renderLiteral(child, fragments, mode, undefined, depth + 1, compact)}`,
    ).join(',\n')}\n${indent}}`;
  }
  return safeJson(value);
}

function schemaName(name: string): string {
  return `CommandInput_${name.replace(/[^A-Za-z0-9]+/g, '_')}`;
}

export function renderCommandArtifacts(): Record<string, string> {
  const definitions = commandRegistry.list().map(command => ({
    name: command.name,
    area: command.name.split('.')[0],
    roles: [...command.roles],
    ...(command.allowPlatformAdmin ? { allowPlatformAdmin: true } : {}),
    ...(command.scope === 'person' ? { scope: 'person' } : {}),
    risk: command.risk,
    description: command.describe,
    inputSchema: z.toJSONSchema(command.input, { io: 'input', unrepresentable: 'any' }),
    runPath: `/api/v1/commands/${command.name}`,
    previewPath: `/api/v1/commands/${command.name}/preview`,
  }));
  const names = definitions.map(command => command.name);
  const metadata = definitions.map(({ inputSchema: _inputSchema, ...entry }) => entry);
  const fragments = sharedFragments([
    ...definitions.map(command => command.inputSchema),
    ...metadata,
  ]);

  const sharedSource = [
    '/* Generated by scripts/generate-commands.ts; do not edit by hand. */',
    ...fragments.entries.map(fragment =>
      `const ${fragment.localName} = ${renderLiteral(fragment.value, fragments, 'local', fragment.key, 0, true)} as const;`,
    ),
    '',
    'export const COMMAND_SCHEMA_PARTS = {',
    ...fragments.entries.map(fragment => `  ${fragment.propertyName}: ${fragment.localName},`),
    '} as const;',
    '',
  ].join('\n');

  const schemaArtifacts = Object.fromEntries(definitions.map(command => {
    const schema = renderLiteral(command.inputSchema, fragments, 'shared');
    const constAssertion = fragments.byKey.has(canonicalJson(command.inputSchema)) ? '' : ' as const';
    const sharedImport = schema.includes('COMMAND_SCHEMA_PARTS.')
      ? ["import { COMMAND_SCHEMA_PARTS } from './shared';"]
      : [];
    return [
      `src/lib/commandSchemas.generated/${command.name.replace('.', '_')}.ts`,
      [
        '/* Generated by scripts/generate-commands.ts; do not edit by hand. */',
        ...sharedImport,
        `export const COMMAND_INPUT_SCHEMA = ${schema}${constAssertion};`,
        '',
      ].join('\n'),
    ];
  }));
  const manifestEntriesByArea = new Map<string, string[]>();
  const schemaImportsByArea = new Map<string, string[]>();
  definitions.forEach((definition, index) => {
    const { inputSchema: _inputSchema, ...entry } = definition;
    const fields = Object.entries(entry).map(([key, value]) =>
      `    ${safeJson(key)}: ${renderLiteral(value, fragments, 'shared', undefined, 2)}`,
    );
    fields.push(`    inputSchema: commandInputSchema${index}`);
    const entries = manifestEntriesByArea.get(entry.area) || [];
    entries.push(`  {\n${fields.join(',\n')}\n  }`);
    manifestEntriesByArea.set(entry.area, entries);

    const imports = schemaImportsByArea.get(entry.area) || [];
    imports.push(`import { COMMAND_INPUT_SCHEMA as commandInputSchema${index} } from '../commandSchemas.generated/${definition.name.replace('.', '_')}';`);
    schemaImportsByArea.set(entry.area, imports);
  });
  const manifestAreas = [...manifestEntriesByArea.keys()];
  const manifestName = (area: string) => `${area.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}_COMMAND_MANIFEST`;
  const manifestArtifacts = Object.fromEntries(manifestAreas.map(area => {
    const entries = manifestEntriesByArea.get(area) || [];
    const imports = schemaImportsByArea.get(area) || [];
    const sharedImport = entries.some(entry => entry.includes('COMMAND_SCHEMA_PARTS.'))
      ? ["import { COMMAND_SCHEMA_PARTS } from '../commandSchemas.generated/shared';"]
      : [];
    return [
      `src/lib/commandManifests.generated/${area}.ts`,
      [
        '/* Generated by scripts/generate-commands.ts; do not edit by hand. */',
        ...imports,
        ...sharedImport,
        '',
        `export const ${manifestName(area)} = [`,
        ...entries.map(entry => `${entry},`),
        '] as const;',
        '',
      ].join('\n'),
    ];
  }));
  const manifest = [
    '/* Generated by scripts/generate-commands.ts; do not edit by hand. */',
    ...manifestAreas.map(area => `import { ${manifestName(area)} } from './commandManifests.generated/${area}';`),
    '',
    'export const COMMAND_MANIFEST = [',
    ...manifestAreas.map(area => `  ...${manifestName(area)},`),
    '] as const;',
    "export type RegisteredCommandName = typeof COMMAND_MANIFEST[number]['name'];",
    '',
  ].join('\n');
  const sdkNames = [
    '/* Generated by scripts/generate-commands.ts; do not edit by hand. */',
    "import type { COMMAND_MANIFEST } from '../src/lib/commands.generated';",
    `export const REGISTERED_COMMAND_NAMES = ${safeJson(names)} as const;`,
    "export type RegisteredCommandName = typeof REGISTERED_COMMAND_NAMES[number];",
    '',
    'type CommandDefinition = (typeof COMMAND_MANIFEST)[number];',
    'type RequiredPropertyKeys<Required, Properties extends Record<string, unknown>> = Required extends readonly (infer Key)[] ? Extract<Key, keyof Properties> : never;',
    'type ObjectSchema<Properties extends Record<string, unknown>, Required> = {',
    '  [Key in RequiredPropertyKeys<Required, Properties>]-?: JsonSchemaToType<Properties[Key]>;',
    '} & {',
    '  [Key in Exclude<keyof Properties, RequiredPropertyKeys<Required, Properties>>]?: JsonSchemaToType<Properties[Key]>;',
    '};',
    'type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (value: infer Intersection) => void ? Intersection : never;',
    '',
    '/** Convert the registry-generated JSON Schema literals to input types without importing server code. */',
    'export type JsonSchemaToType<Schema> =',
    '  Schema extends { const: infer Constant } ? Constant :',
    '  Schema extends { enum: readonly (infer Value)[] } ? Value :',
    '  Schema extends { anyOf: readonly (infer Variant)[] } ? JsonSchemaToType<Variant> :',
    '  Schema extends { oneOf: readonly (infer Variant)[] } ? JsonSchemaToType<Variant> :',
    '  Schema extends { allOf: readonly (infer Part)[] } ? UnionToIntersection<JsonSchemaToType<Part>> :',
    '  Schema extends { type: "array"; items: infer Item } ? JsonSchemaToType<Item>[] :',
    '  Schema extends { type: "object"; properties: infer Properties extends Record<string, unknown>; required?: infer Required } ? ObjectSchema<Properties, Required> :',
    '  Schema extends { type: "object"; additionalProperties: infer Extra } ? Record<string, JsonSchemaToType<Extra>> :',
    '  Schema extends { type: "object" } ? Record<string, unknown> :',
    '  Schema extends { type: infer Type } ? (Type extends readonly unknown[] ? JsonSchemaPrimitive<Type[number]> : JsonSchemaPrimitive<Type>) :',
    '  unknown;',
    'type JsonSchemaPrimitive<Type> = Type extends "string" ? string : Type extends "integer" | "number" ? number : Type extends "boolean" ? boolean : Type extends "null" ? null : Type extends "object" ? Record<string, unknown> : Type extends "array" ? unknown[] : unknown;',
    '',
    'type CommandInputByName = {',
    '  [Definition in CommandDefinition as Definition["name"]]: JsonSchemaToType<Definition["inputSchema"]>;',
    '};',
    '/** Validated input shape for each registry-backed command. */',
    'export type CommandInput<Name extends RegisteredCommandName> = CommandInputByName[Name];',
    '',
  ].join('\n');
  const openApiSchemas = [
    '/* Generated by scripts/generate-commands.ts; do not edit by hand. */',
    `export const COMMAND_INPUT_SCHEMA_NAMES = ${safeJson(Object.fromEntries(definitions.map(command => [command.name, schemaName(command.name)])))} as const;`,
    '',
  ].join('\n');
  return {
    'assistant/tools.json': renderAssistantTools(definitions),
    'src/lib/commands.generated.ts': manifest,
    ...manifestArtifacts,
    'src/lib/commandSchemas.generated/shared.ts': sharedSource,
    ...schemaArtifacts,
    'sdk/commands.generated.ts': sdkNames,
    'src/server/commands/openApiSchemas.generated.ts': openApiSchemas,
  };
}

export function writeCommandArtifacts(root = ROOT): string[] {
  const files = renderCommandArtifacts();
  for (const [relativePath, content] of Object.entries(files)) {
    const destination = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  }
  return Object.keys(files);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  for (const file of writeCommandArtifacts()) console.log(`Generated ${file}`);
}
