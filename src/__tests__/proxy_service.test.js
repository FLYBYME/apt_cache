const stream = require('stream');
const { CacheManager } = require('../cache_manager');
const { HttpProxyService } = require('../proxy_service');

class MockResponse extends stream.PassThrough {
  constructor() {
    super();
    this.statusCode = null;
    this.headers = {};
    this.endData = '';
  }
  writeHead(status, headers) {
    this.statusCode = status;
    this.headers = headers;
  }
  end(data) {
    if (data !== undefined) {
      this.endData += data.toString();
    }
    super.end();
  }
}

describe('HttpProxyService', () => {
  test('unknown host ends with host string', done => {
    const cache = new CacheManager('a.com,127.0.0.1');
    const svc = new HttpProxyService(cache, '');
    const handler = svc.createServerHandler();

    const req = { url: '/file.txt', headers: { host: 'b.com' } };
    const res = new MockResponse();
    res.on('finish', () => {
      expect(res.endData).toBe('b.com');
      done();
    });

    handler(req, res);
  });
});
