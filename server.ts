import * as http from 'http';
import { CacheManager } from './src/cache_manager';
import { HttpProxyService } from './src/proxy_service';
import { ConfigManager } from './src/config_manager';
import { config } from './src/config';


/**
 * Main entry point for the proxy server.
 * This file is responsible only for wiring up dependencies and starting the HTTP server.
 */

const port: number = ConfigManager.getPort();
const cacheManager = new CacheManager(config.HOSTS);
const proxyService = new HttpProxyService(cacheManager);

const server: http.Server = http.createServer(proxyService.createServerHandler());

server.listen(port, () => {
    console.log(`✅ Proxy Service listening on port ${port}`);
});
