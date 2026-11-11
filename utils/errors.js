// One error type for everything the API reports on purpose.
// The error handler turns these into { ok: false, error: { code, message, details } }.
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message = 'The request could not be understood.', details) =>
  new ApiError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Sign in to continue.') => new ApiError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to do that.', code = 'FORBIDDEN') =>
  new ApiError(403, code, message);
export const notFound = (message = 'We could not find what you were looking for.') =>
  new ApiError(404, 'NOT_FOUND', message);
export const conflict = (message = 'That conflicts with the current state.', code = 'CONFLICT', details) =>
  new ApiError(409, code, message, details);
export const unprocessable = (message = 'Some details need fixing.', details) =>
  new ApiError(422, 'VALIDATION_ERROR', message, details);
export const tooMany = (message = 'Too many requests. Try again shortly.') =>
  new ApiError(429, 'RATE_LIMITED', message);
