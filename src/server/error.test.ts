import { HttpError, BadRequestError, NotFoundError, InternalServerError, handleError, asyncHandler } from './error';
import * as http from 'http';

describe('Error Module', () => {
  describe('HttpError Classes', () => {
    it('should create HttpError with status code', () => {
      const error = new HttpError(401, 'Unauthorized', { detail: 'some detail' });
      expect(error.statusCode).toBe(401);
      expect(error.message).toBe('Unauthorized');
      expect(error.details).toEqual({ detail: 'some detail' });
    });

    it('should create BadRequestError', () => {
      const error = new BadRequestError();
      expect(error.statusCode).toBe(400);
      expect(error.message).toBe('Bad Request');
    });

    it('should create NotFoundError', () => {
      const error = new NotFoundError();
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('Not Found');
    });

    it('should create InternalServerError', () => {
      const error = new InternalServerError();
      expect(error.statusCode).toBe(500);
      expect(error.message).toBe('Internal Server Error');
    });
  });

  describe('handleError', () => {
    let mockResponse: any;

    beforeEach(() => {
      mockResponse = {
        writeHead: jest.fn(),
        end: jest.fn(),
        headersSent: false,
        writableEnded: false,
      };
      // Suppress console.error in tests
      jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      (console.error as jest.Mock).mockRestore();
    });

    it('should send correct response for HttpError', () => {
      const error = new NotFoundError('File not found', { path: '/foo' });
      handleError(error, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
      const responseData = JSON.parse(mockResponse.end.mock.calls[0][0]);
      expect(responseData.error.code).toBe(404);
      expect(responseData.error.message).toBe('File not found');
      expect(responseData.error.details).toEqual({ path: '/foo' });
    });

    it('should send 500 for generic Error', () => {
      const error = new Error('Something went wrong');
      handleError(error, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
      expect(mockResponse.end).toHaveBeenCalledWith(expect.stringContaining('Something went wrong'));
    });

    it('should send message if error is a string', () => {
      handleError('Some string error', mockResponse);
      expect(mockResponse.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
      expect(mockResponse.end).toHaveBeenCalledWith(expect.stringContaining('Some string error'));
    });

    it('should send details if error is a generic object', () => {
      const errorObj = { foo: 'bar' };
      handleError(errorObj, mockResponse);
      expect(mockResponse.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
      const responseData = JSON.parse(mockResponse.end.mock.calls[0][0]);
      expect(responseData.error.details).toEqual(errorObj);
    });

    it('should not write head if headers already sent', () => {
      mockResponse.headersSent = true;
      handleError(new Error('error'), mockResponse);
      expect(mockResponse.writeHead).not.toHaveBeenCalled();
      expect(mockResponse.end).toHaveBeenCalled();
    });

    it('should not end if writable already ended', () => {
      mockResponse.headersSent = true;
      mockResponse.writableEnded = true;
      handleError(new Error('error'), mockResponse);
      expect(mockResponse.end).not.toHaveBeenCalled();
    });
  });

  describe('asyncHandler', () => {
    it('should wrap an async handler and catch errors', async () => {
      const error = new Error('async error');
      const handler = async (req: any, res: any) => {
        throw error;
      };
      
      const mockReq: any = {};
      const mockRes: any = {
        writeHead: jest.fn(),
        end: jest.fn(),
        headersSent: false,
      };
      
      jest.spyOn(console, 'error').mockImplementation(() => {});
      
      const wrapped = asyncHandler(handler);
      wrapped(mockReq, mockRes);
      
      // Since it's async, we need to wait for the next tick
      await new Promise(resolve => setImmediate(resolve));
      
      expect(mockRes.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
      (console.error as jest.Mock).mockRestore();
    });
  });
});
