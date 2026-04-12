/**
 * Thrown when tool arguments fail business validation (E12: VALIDATION_FAILED).
 * Prefer returning JSON via {@link toErrorPayload} in tool catch blocks, not MCP protocol errors.
 */
export class ValidationError extends Error {
  readonly code = 'VALIDATION_FAILED' as const;

  constructor(
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}
