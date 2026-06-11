import * as http from 'http';
import * as fs from 'fs-extra';
import * as path from 'path';
import { CacheManager } from './cache_manager';

/**
 * Handles the core HTTP proxying and routing logic, depending on a cache manager.
 * This class isolates the complex request processing (Business Logic) from server setup.
 */
export class HttpProxyService {
    private cacheManager: CacheManager;

    constructor(cacheManager: CacheManager) {
        this.cacheManager = cacheManager;
    }

    public createServerHandler(): (req: http.IncomingMessage, res: http.ServerResponse) => void {
        return (req: http.IncomingMessage, res: http.ServerResponse) => {
            const urlStr: string = req.url || '';
            const pathnameParts: string[] = urlStr.split('/');
            const filename: string = pathnameParts.pop() || 'index.html';
            const pathname: string = pathnameParts.join('/');

            const host: string = req.headers.host || '';
            const dir: string = path.join('./files', host, pathname);
            const fullPath: string = path.join(dir, filename);

            const hostNamesMap = this.cacheManager.getHostnames();
            if (!hostNamesMap[host]) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Host not found');
                return;
            }

            const options: http.RequestOptions = {
                hostname: hostNamesMap[host],
                port: 80,
                path: req.url,
                method: req.method,
                headers: req.headers
            };

            const cacheExtensions: string[] = ['.deb', '.udeb', '.iso', '.apk', '.tar.xz', '.tar.gz', 'rke_linux-amd64']; // Note: 'rke_linux-amd64' without leading dot is intentional.
            const shouldCache: boolean = cacheExtensions.some(v => filename.includes(v));

            if (shouldCache) {
                const onDownload = async () => {
                    try {
                        await this.cacheManager.download(options, fullPath);
                        fs.stat(fullPath, (statErr: Error | null, stats: fs.Stats): void => {
                            if (statErr) {
                                res.writeHead(500);
                                res.end();
                            } else {
                                this.cacheManager.uploadFile(fullPath, stats, res);
                            }
                        });
                    } catch (e: any) {
                        console.error('Failed to cache file:', e.message);
                        res.writeHead(500);
                        res.end();
                    }
                };

                if (this.cacheManager.isDownloading(fullPath)) {
                    res.writeHead(503);
                    return res.end('Content is currently being downloaded.');
                }

                fs.stat(fullPath, (statErr: Error | null, stats: fs.Stats): void => {
                    if (statErr) {
                        onDownload();
                    } else {
                        console.log(`file cached ${filename}`);
                        this.cacheManager.uploadFile(fullPath, stats, res);
                    }
                });
            } else {
                if (false && (filename === 'InRelease' || filename === 'Release')) {
                    const cacheKey: string = req.url || '';
                    const buf: Buffer | undefined = this.cacheManager.getCachedContent(cacheKey);
                    if (buf) {
                        const buffer = buf;
                        res.writeHead(200, { 'content-length': buffer.length });
                        res.end(buffer);
                        return;
                    }

                    console.log(`http://${host}${req.url}`);
                    const get: http.ClientRequest = http.request(options, (_res: http.IncomingMessage): void => {
                        const statusCode: number = _res.statusCode || 200;
                        res.writeHead(statusCode, _res.headers);
                        if (typeof res.write === 'function') {
                        _res.pipe(res);
                    } else {
                        const chunks: Buffer[] = [];
                        _res.on('data', d => chunks.push(d));
                        _res.once('end', () => {
                            res.end(Buffer.concat(chunks));
                        });
                    }
                        const bufs: Buffer[] = [];
                        _res.on('data', (d: Buffer): void => { bufs.push(d); });
                        _res.on('end', (): void => {
                            this.cacheManager.cacheResource(cacheKey, Buffer.concat(bufs));
                        });
                    });
                    get.once('error', (): void => { res.end(); });
                    get.end();
                    return;
                }

                const get: http.ClientRequest = http.request(options, (_res: http.IncomingMessage): void => {
                    const statusCode: number = _res.statusCode || 200;
                    res.writeHead(statusCode, _res.headers);
                    if (typeof res.write === 'function') {
                        _res.pipe(res);
                    } else {
                        const chunks: Buffer[] = [];
                        _res.on('data', d => chunks.push(d));
                        _res.once('end', () => {
                            res.end(Buffer.concat(chunks));
                        });
                    }
                });
                get.once('error', (): void => { res.end(); });
                get.end();
            }
        };
    }
}
