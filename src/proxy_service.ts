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
            const filename: string = pathnameParts.pop() || '';
            const pathname: string = pathnameParts.join('/');

            const host: string = req.headers.host || '';
            const dir: string = path.join('./files', host, pathname);
            const fullPath: string = path.join(dir, filename);

            const hostNamesMap = this.cacheManager.getHostnames();
            if (!hostNamesMap[host]) {
                res.end(host);
                return;
            }

            const options: http.RequestOptions = {
                hostname: hostNamesMap[host],
                port: 80,
                path: req.url,
                method: req.method,
                headers: req.headers
            };

            const cacheExtensions: string[] = ['.deb', '.udeb', '.iso', '.apk', '.tar.xz', '.tar.gz', 'rke_linux-amd64'];
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
                        this.cacheManager.download(options, fullPath)
                            .then(() => onDownload())
                            .catch((e: any) => console.error('Download failed:', e));
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
                        res.writeHead(200, { 'content-length': buf.length });
                        res.end(buf);
                        return;
                    }

                    console.log(`http://${host}${req.url}`);
                    const get: http.ClientRequest = http.request(options, (_res: http.IncomingMessage): void => {
                        const statusCode: number = _res.statusCode || 200;
                        res.writeHead(statusCode, _res.headers);
                        _res.pipe(res);
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
                    _res.pipe(res);
                });
                get.once('error', (): void => { res.end(); });
                get.end();
            }
        };
    }
}
