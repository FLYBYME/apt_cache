import * as http from 'http';

/**
 * Base class for HTTP-related errors.
 */
export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly details?: any;

  constructor(statusCode: number, message: string, details?: any) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * 400 Bad Request
 */
export class BadRequestError extends HttpError {
  constructor(message: string = 'Bad Request', details?: any) {
    super(400, message, details);
  }
}

/**
 * 404 Not Found
 */
export class NotFoundError extends HttpError {
  constructor(message: string = 'Not Found', details?: any) {
    super(404, message, details);
  }
}

/**
 * 500 Internal Server Error
 */
export class InternalServerError extends HttpError {
  constructor(message: string = 'Internal Server Error', details?: any) {
    super(500, message, details);
  }
}

/**
 * Logic to handle errors and send consistent HTTP responses.
 * Can be used in both synchronous and asynchronous contexts.
 */
export function handleError(
  err: any,
  res: http.ServerResponse
): void {
  if (!err) return;

  let statusCode = 500;
  let message = 'An unexpected error occurred';
  let details: any = undefined;

  if (err instanceof HttpError) {
    statusCode = err.statusCode;
    message = err.message;
    details = err.details;
  } else if (err instanceof Error) {
    message = err.message;
    // For non-HttpError Error objects, we might want to log the stack trace
    console.error(`[Unhandled Error] ${err.stack}`);
  } else if (typeof err === 'string') {
    message = err;
  } else {
    details = err;
  }

  console.error(`[HttpError] ${statusCode} - ${message}`);

  if (!res.headersSent) {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
    });
    res.end(
      JSON.stringify({
        error: {
          code: statusCode,
          message: message,
          ...(details && { details }),
        },
      })
    );
  } else {
    // If headers already sent, we can't change the status code
    if (!res.writableEnded) {
      res.end();
    }
  }
}

/**
 * Higher-order function to wrap async request handlers and catch errors.
 * Provides a middleware-like integration for error handling.
 */
export function asyncHandler(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>
) {
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    handler(req, res).catch((err) => handleError(err, res));
  };
}
