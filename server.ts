import * as http from 'http';
import { CacheManager } from './src/cache_manager';
import { HttpProxyService } from './src/proxy_service';
import { config } from './src/config';

// Load application version from package.json at runtime.
const { version } = require('./package.json'); // eslint-disable-line @typescript-eslint/no-var-requires

/**
 * Main entry point for the proxy server.
 * This file wires up dependencies and starts the HTTP server.
 */

const port: number = config.PROXY_PORT;
const cacheManager = new CacheManager(config.HOSTS);
const proxyService = new HttpProxyService(cacheManager);
const proxyHandler = proxyService.createServerHandler();

const server: http.Server = http.createServer((req, res) => {
    // Health check endpoint.
    if (req.url === '/health') {
        const hostsMap = cacheManager.getHostnames();
        const payload = {
            status: 'ok',
            version,
            port: config.PROXY_PORT,
            hostsCount: Object.keys(hostsMap).length,
            maxRetries: config.MAX_RETRIES,
            logLevel: config.LOG_LEVEL
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
        return; // short-circuit to avoid proxy logic.
    }

    // Delegate all other requests to the proxy service.
    proxyHandler(req, res);
});

server.listen(port, () => {
    console.log(`✅ Proxy Service listening on port ${port}`);
});
