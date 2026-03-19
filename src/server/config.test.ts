import { Config } from './config';

describe('Config Module', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should have default values', () => {
    const { config } = require('./config');
    expect(config.port).toBe(9080);
    expect(config.baseDir).toBe('./files');
    expect(config.cacheTtl).toBe(60000);
    expect(config.hostnames).toEqual({});
  });

  it('should handle empty HOSTS gracefully', () => {
    process.env.HOSTS = '';
    const { config } = require('./config');
    expect(config.hostnames).toEqual({});
  });

  it('should parse PORT from environment', () => {
    process.env.PORT = '8080';
    const { config } = require('./config');
    expect(config.port).toBe(8080);
  });

  it('should parse HOSTS from environment', () => {
    process.env.HOSTS = 'debian,10.0.0.1!ubuntu,10.0.0.2';
    const { config } = require('./config');
    expect(config.hostnames).toEqual({
      debian: '10.0.0.1',
      ubuntu: '10.0.0.2',
    });
  });

  it('should handle invalid HOSTS format gracefully', () => {
    process.env.HOSTS = 'invalid-format';
    const { config } = require('./config');
    expect(config.hostnames).toEqual({ 'invalid-format': undefined });
  });

  it('should include default cacheExtensions', () => {
    const { config } = require('./config');
    expect(config.cacheExtensions).toContain('.deb');
    expect(config.cacheExtensions).toContain('.apk');
  });
});
