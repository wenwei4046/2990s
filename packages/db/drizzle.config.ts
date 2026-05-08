import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

config({ path: '../../.env' });

// generate only reads schema.ts. push/migrate/studio need DATABASE_URL — they
// will error at runtime when the empty string is rejected by postgres-js.
const url = process.env.DATABASE_URL ?? '';

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  casing: 'snake_case',
  verbose: true,
  strict: true,
});
