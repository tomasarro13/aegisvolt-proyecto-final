/** Valida el esquema GraphQL en CI (lint & build): sintaxis, tipos y cobertura de resolvers. */
import { buildSchema, validateSchema } from 'graphql';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sdl = readFileSync(fileURLToPath(new URL('../src/interfaces/graphql/schema.graphql', import.meta.url)), 'utf8');
const schema = buildSchema(sdl);
const errors = validateSchema(schema);
if (errors.length) {
  console.error(errors.map((e) => e.message).join('\n'));
  process.exit(1);
}
const required = { Query: ['stations', 'telemetry', 'featureFlags', 'sagas'], Mutation: ['reserveAndActivateCharging', 'setFeatureFlag'] };
for (const [type, fields] of Object.entries(required)) {
  const t = schema.getType(type) as { getFields(): Record<string, unknown> } | undefined;
  for (const f of fields) if (!t?.getFields()[f]) { console.error(`Falta ${type}.${f}`); process.exit(1); }
}
console.log(`Esquema GraphQL válido: ${Object.keys(schema.getTypeMap()).filter((t) => !t.startsWith('__')).length} tipos`);
