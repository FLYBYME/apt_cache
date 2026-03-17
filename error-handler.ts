import { Request, Response } from './http-handler';

export function handleError(error: Error, request: Request): Response {
  return {
    statusCode: 500,
    body: JSON.stringify({
      error: 'Internal Server Error',
      message: error.message,
      path: request.path
    })
  };
}