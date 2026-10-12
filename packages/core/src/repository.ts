import type { EditableProject, Mode, Project, ProjectSummary } from './project.ts';

/**
 * Persistence boundary for projects. Media functions depend on this interface, not on the database,
 * so they can be tested with any implementation.
 */
export interface ProjectRepository {
  /** Folder holding the project's media files (source, proxy, stems, takes, exports). */
  dir(id: string): string;
  /** Absolute path of a file inside the project folder (validated). */
  file(id: string, name: string): string;
  exists(id: string): boolean;
  create(input: { name?: string; mode?: Mode; template?: boolean }): Project;
  /** Throws AppError(404) when missing. */
  get(id: string): Project;
  save(p: Project): Project;
  /** Merge client-editable fields; the server owns media and stems. */
  update(id: string, patch: Partial<EditableProject>): Project;
  list(filter?: { template?: boolean }): ProjectSummary[];
  /** A new project from a library clip: shares its media files (hard links), copies its prepared work. */
  derive(templateId: string, input: { name?: string; mode: Mode }): Project;
  remove(id: string): void;
}
