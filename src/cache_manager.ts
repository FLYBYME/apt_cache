import * as http from 'http';
import * as fse from 'fs-extra';
import * as path from 'path';
import * as mime from 'mime';
import { config }from './config';

export class HttpError extends Error {
    public statusCode: number;
    constructor(statusCode: number, message: string) {
        super(message);
        this.name = 'HttpError';
        this.statusCode = statusCode;
    }
}

interface Hostnames {
    [key: string]: string;
}

export class CacheManager {
    private hostnames: Hostnames;
    private cacheData: { [key: string]: Buffer } = {};
    private pendingDownloads: Map<string, Promise<void>> = new Map();

    constructor(hostsEnv: string) {
        this.hostnames = {};
        const hosts = hostsEnv || '';
        hosts.split('!').forEach(str => {
            const parts = str.split(',');
            const hostname = parts[0];
            const ip = parts[1];
            if (hostname) {
                this.hostnames[hostname] = ip;
            }
        });
    }

    public isDownloading(dest: string): boolean {
        return this.pendingDownloads.has(dest);
    }

    public async download(options: http.RequestOptions, dest: string): Promise<void> {
        const existing = this.pendingDownloads.get(dest);
        if (existing) {
            return existing;
        }

        const promise = (async () => {
            try {
                await this._attemptDownload(options, dest);
            } finally {
                this.pendingDownloads.delete(dest);
            }
        })();

        this.pendingDownloads.set(dest, promise);
        return promise;
    }

    private async _attemptDownload(options: http.RequestOptions, dest: string): Promise<void> {
        const BASE_DELAY_MS = 200;
        let retriesLeft = config.MAX_RETRIES;

        while (true) {
            try {
                await this._singleAttempt(options, dest);
                return;
            } catch (err) {
                if (retriesLeft === 0) throw err;
                const delayMs = BASE_DELAY_MS * Math.pow(2, config.MAX_RETRIES - retriesLeft);
                await new Promise(r => setTimeout(r, delayMs));
                retriesLeft--;
            }
        }
    }

    private async _singleAttempt(options: http.RequestOptions, dest: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const fileWriteStream = fse.createWriteStream(dest);
            let receivedLength = 0;

            const req = http.request(options, (res: http.IncomingMessage) => {
                const contentLengthHeader = res.headers['content-length'];
                const expectedLength = Number(contentLengthHeader || '0');

                res.on('data', chunk => {
                    receivedLength += Buffer.isBuffer(chunk) ? chunk.length : 0;
                    fileWriteStream.write(chunk);
                });

                res.on('end', () => {
                    fileWriteStream.end();
                    if (expectedLength && receivedLength !== expectedLength) {
                        fse.unlink(dest, () => {});
                        reject(new HttpError(500, 'length mismatch after download'));
                    } else {
                        resolve();
                    }
                });
            });

            req.on('error', err => {
                fileWriteStream.destroy();
                fse.unlink(dest, () => {});
                reject(new HttpError(500, 'Connection error'));
            });

            req.end();
        });
    }

    public uploadFile(source: string, stats: fse.Stats, res: http.ServerResponse): void {
        const ext = path.extname(source);
        const contentType = mime.getType(ext) || 'application/octet-stream';
        res.writeHead(200, {
            'content-length': stats.size,
            'content-type': contentType
        });
        fse.createReadStream(source).pipe(res);
    }

    public getCachedContent(key: string): Buffer | undefined {
        return this.cacheData[key];
    }

    public cacheResource(key: string, buffer: Buffer) {
        this.cacheData[key] = buffer;
        setTimeout(() => delete this.cacheData[key], 60 * 1000);
    }

    public getHostnames(): Hostnames {
        return this.hostnames;
    }
}
