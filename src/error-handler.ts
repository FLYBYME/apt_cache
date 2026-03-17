import { createReadStream, createWriteStream } from 'fs';
import { Readable, Writable } from 'stream';
import { createServer as createHttpServer } from 'http';
import { TypedErrorObject } from './types/index.js';

/**
 * Handle errors by returning a typed error object.
 *
 * @param {Error | null} err - The error to handle.
 * @returns {TypedErrorObject} A typed error object.
 */
export function handleError(err: Error | null): TypedErrorObject {
  if (!err) {
    return {
      message: 'Unknown error occurred',
      code: 'UNKNOWN_ERROR',
    };
  }

  return {
    message: err.message,
    code: err.name || 'INTERNAL_ERROR',
    stack: err.stack,
  };
}