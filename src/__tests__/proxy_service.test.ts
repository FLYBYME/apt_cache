import * as stream from 'stream';
import { CacheManager } from '../cache_manager';
import { HttpProxyService } from '../proxy_service';

// Helper mock response that captures data passed to end()
class MockResponse extends stream.PassThrough {
  public headersSent = false;
  public statusCode?: number;
  public headers: any = {};
  constructor() {
    super();
    this.writeHead = this.writeHead.bind(this);
    this.end = this.end.bind(this);
  }
  writeHead(status: number, headers: any) {
    this.statusCode = status;
    this.headers = headers;
  }
  end(data?: any) {
    if (data !== undefined) {
      // push data into stream for assertion
      this.push(data);
    }
    this.end();
  }
}

describe('HttpProxyService', () => {
  test('unknown host ends with host string', done => {
    const cache = new CacheManager('a.com,127.0.0.1');
    const svc = new HttpProxyService(cache, '');
    const handler = svc.createServerHandler();

    const req: any = { url: '/file.txt', headers: { host: 'b.com' } };
    const res = new MockResponse();
    let data: Buffer | null = null;
    res.on('data', chunk => {
      data = Buffer.concat([data || Buffer.alloc(0), chunk]);
    });
    res.on('end', () => {
      expect(data?.toString()).toBe('b.com');
      done();
    });

    handler(req, res as any);
  });
});
