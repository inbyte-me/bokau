import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` diffs src/schema.ts against the last snapshot and writes a new SQL migration to ./drizzle.
// Migrations are applied automatically when the app opens the database (see src/client.ts).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
});
