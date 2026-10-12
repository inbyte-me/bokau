import type { Media, Mode, Project, Stems } from '@doblaje/core';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Everything in a project except the columns stored on their own. */
export type ProjectDocument = Omit<Project, 'id' | 'name' | 'mode' | 'createdAt' | 'updatedAt' | 'media' | 'stems' | 'template' | 'sourceTemplateId'>;

/**
 * One row per project. The editable document (cues, tracks, mix settings…) is a JSON column: it is always
 * loaded and saved as a whole by the editor, so normalising it would only add joins. Columns that are
 * listed, sorted or owned by the server live outside the document.
 * Media files (video, stems, takes, exports) stay on disk under data/projects/<id>/.
 */
export const projects = sqliteTable(
  'projects',
  {
    id: text().primaryKey(),
    name: text().notNull(),
    mode: text().$type<Mode>().notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    document: text({ mode: 'json' }).$type<ProjectDocument>().notNull(),
    /** written by ingest only */
    media: text({ mode: 'json' }).$type<Media>(),
    /** written by stem separation only */
    stems: text({ mode: 'json' }).$type<Stems>().notNull(),
    /** a clip in the library: prepared once (voices, subtitles), never recorded on; projects are derived from it */
    template: integer({ mode: 'boolean' }).notNull().default(false),
    /** the library clip this project was derived from */
    sourceTemplateId: text('source_template_id'),
  },
  (t) => [index('projects_updated_at_idx').on(t.updatedAt), index('projects_template_idx').on(t.template)],
);

/** Every paid OpenRouter call, with the cost OpenRouter reported. The spend cap is the sum of cost_usd. */
export const aiCalls = sqliteTable('ai_calls', {
  id: integer().primaryKey({ autoIncrement: true }),
  at: text().notNull(),
  model: text().notNull(),
  task: text(),
  costUsd: real('cost_usd').notNull(),
  tokens: integer().notNull().default(0),
});

/** Small key/value facts about this installation (e.g. that the legacy JSON files were imported). */
export const meta = sqliteTable('meta', {
  key: text().primaryKey(),
  value: text().notNull(),
});
