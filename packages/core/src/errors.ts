/** An error that carries the HTTP status it should be reported with. Thrown by repositories and services. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));
