export type CengageErrorCode =
  | 'auth_required'
  | 'invalid_input'
  | 'navigation_failed'
  | 'parse_failed';

export class CengageError extends Error {
  readonly code: CengageErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: CengageErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'CengageError';
    this.code = code;
    this.details = details;
  }
}

export class CengageAuthRequiredError extends CengageError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('auth_required', message, details);
    this.name = 'CengageAuthRequiredError';
  }
}

export class CengageInvalidInputError extends CengageError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('invalid_input', message, details);
    this.name = 'CengageInvalidInputError';
  }
}

export class CengageNavigationError extends CengageError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('navigation_failed', message, details);
    this.name = 'CengageNavigationError';
  }
}

export class CengageParseError extends CengageError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('parse_failed', message, details);
    this.name = 'CengageParseError';
  }
}
