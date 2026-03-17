export interface Request {
  method: 'GET' | 'POST';
  path: string;
}

export interface Response {
  statusCode: number;
  body: string;
}

export function handleRequest(request: Request): Response {
  if (request.method === 'GET') {
    return {
      statusCode: 200,
      body: `Successfully handled GET request for ${request.path}`
    };
  }
  
  if (request.method === 'POST') {
    return {
      statusCode: 201,
      body: `Successfully handled POST request for ${request.path}`
    };
  }
  
  return {
    statusCode: 405,
    body: 'Method Not Allowed'
  };
}