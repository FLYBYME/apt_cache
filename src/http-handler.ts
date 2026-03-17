import { createReadStream, createWriteStream } from 'fs';
import { Readable, Writable } from 'stream';
import { createServer as createHttpServer } from 'http';
import { Request, Response } from './types/index.js';
import { handleError } from './error-handler.js';

/**
 * Handle HTTP request routing and response creation.
 *
 * @param {Request} req - The incoming request.
 * @returns {Response} The response object.
 */
export function handleRequest(req: Request): Response {
  try {
    // Example routing logic
    if (req.method === 'GET' && req.url === '/health') {
      return {
        status: 200,
        data: { status: 'ok' },
        headers: { 'Content-Type': 'application/json' },
      };
    }

    return {
      status: 404,
      data: { error: 'Not Found' },
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (err) {
    const typedError = handleError(err instanceof Error ? err : new Error(String(err)));
    return {
      status: 500,
      data: typedError,
      headers: { 'Content-Type': 'application/json' },
    };
  }
}

/**
 * Start the HTTP server.
 *
 * @param {number} port - The port to listen on.
 */
export function startServer(port: number): void {
  const server = createHttpServer((nodeReq, nodeRes) => {
    let body = '';
    nodeReq.on('data', (chunk) => {
      body += chunk.toString();
    });

    nodeReq.on('error', (err) => {
      const typedError = handleError(err);
      nodeRes.writeHead(500, { 'Content-Type': 'application/json' });
      nodeRes.end(JSON.stringify(typedError));
    });

    nodeReq.on('end', () => {
      try {
        const req: Request = {
          method: nodeReq.method || 'GET',
          url: nodeReq.url || '/',
          body: body ? JSON.parse(body) : {},
        };

        const response = handleRequest(req);

        nodeRes.writeHead(response.status, response.headers);
        nodeRes.end(JSON.stringify(response.data));
      } catch (err) {
        const typedError = handleError(err instanceof Error ? err : new Error(String(err)));
        nodeRes.writeHead(400, { 'Content-Type': 'application/json' });
        nodeRes.end(JSON.stringify({ error: 'Invalid Request', details: typedError }));
      }
    });
  });

  server.on('error', (err) => {
    console.error('Server error:', handleError(err));
  });

  server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
  });
}