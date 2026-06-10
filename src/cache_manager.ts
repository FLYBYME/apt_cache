import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as mime from 'mime';
import * as crypto from 'crypto';

/**
 * Custom error class for HTTP related errors.
 */
class HttpError extends Error {
    public statusCode: number;
    constructor(statusCode: number, message: string) {
        super(message);
        this.name = 'HttpError';
        this.statusCode = statusCode;
    }
}

export interface Hostnames { [key: string]: string; }

/**
 * Manages file caching, downloading, and serving logic for the application.
 */
export class CacheManager {
    private hostnames: Hostnames;
    // Map of destination path to ongoing download Promise
    private ongoingDownloads: { [dest: string]: Promise<void> } = {};
    private cacheData: { [key: string]: Buffer } = {};

    constructor(hostsEnv: string) {
        this.hostnames = {} as Hostnames;
        const hosts = hostsEnv || '';
        hosts.split('!').forEach((str: string): void => {
            const parts: string[] = str.split(',');
            const hostname: string = parts[0];
            const ip: string | undefined = parts[1];
            if (hostname) {
                this.hostnames[hostname] = ip ?? '';
            }
        });
    }

    public isDownloading(dest: string): boolean {
        return !!this.ongoingDownloads[dest];
    }

    /**
     * Downloads a file from the given options and saves it to dest, handling concurrency by queuing.
     */
    public async download(options: http.RequestOptions, dest: string): Promise<void> {
        // If a download is already in progress for this destination, return the existing promise
        if (this.ongoingDownloads[dest]) {
            return this.ongoingDownloads[dest];
        }

        const promise = new Promise<void>(async (resolve, reject) => {
            try {
                // Ensure destination directory exists
                await fs.promises.mkdir(path.dirname(dest), { recursive: true });

                let dataLength = 0;
                const request = http.request(options, (response) => {
                    const contentLengthHeader = response.headers['content-length'];
                    const expectedLength = Number(contentLengthHeader || '0');

                    // Hash calculation
                    const hash = crypto.createHash('sha1').setEncoding('hex');
                    response.on('data', (chunk: Buffer) => {
                        dataLength += chunk.length;
                        hash.update(chunk);
                    });

                    const fileWriteStream = fs.createWriteStream(dest);
                    response.pipe(fileWriteStream);

                    fileWriteStream.on('finish', () => {
                        hash.end();
                        if (expectedLength !== 0 && expectedLength !== dataLength) {
                            fs.unlink(dest, () => {});
                            reject(new Error('length mismatch'));
                            return;
                        }
                        console.log(`file downloaded ${path.basename(dest)} ${expectedLength} = ${dataLength}`);
                        resolve();
                    });

                    response.on('error', (err: Error) => {
                        fs.unlink(dest, () => {});
                        reject(err);
                    });
                });

                request.on('error', (err: Error) => {
                    console.log('http.request general err', err);
                    reject(err);
                });

                request.end();
            } catch (err) {
                reject(err as any);
            }
        });

        this.ongoingDownloads[dest] = promise;
        try {
            await promise;
        } finally {
            delete this.ongoingDownloads[dest];
        }
    }

    public uploadFile(source: string, stats: fs.Stats, res: http.ServerResponse): void {
        const ext = path.extname(source);
        const contentType = mime.getType(ext) || 'application/octet-stream';
        res.writeHead(200, {
            'content-length': stats.size,
            'content-type': contentType
        });
        fs.createReadStream(source).pipe(res);
    }

    public getCachedContent(key: string): Buffer | undefined {
        return this.cacheData[key];
    }

    public cacheResource(key: string, buffer: Buffer) {
        this.cacheData[key] = buffer;
        setTimeout(() => {
            delete this.cacheData[key];
        }, 60 * 1000);
    }

    public getHostnames(): Hostnames {
        return this.hostnames;
    }
}
