import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = ReturnType<typeof createClient>;

export function createClient(databaseUrl: string) {
  const queryClient = postgres(databaseUrl, {
    prepare: false,
    max: 10,
  });
  return drizzle(queryClient, { schema, casing: 'snake_case' });
}

export { schema };
