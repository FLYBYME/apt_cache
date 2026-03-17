import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as fse from 'fs-extra';
import * as mime from 'mime';
import * as crypto from 'crypto';

/**
 * Custom error class for HTTP related errors.
 */
class HttpError extends Error {
    public statusCode: number;
    constructor(statusCode: number, message: string) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'HttpError';
    }
}

interface Hostnames {
    [key: string]: string;
}

interface DownloadingCallbacks {
    [key: string]: Array<(err?: Error | string | null) => void>;
}

interface ResponseCache {
    [key: string]: Buffer;
}

const hostnames: Hostnames = {};

const hostsEnv: string = process.env.HOSTS || '';
hostsEnv.split('!').forEach((str: string): void => {
    const parts: string[] = str.split(',');
    const hostname: string = parts[0];
    const ip: string = parts[1];
    if (hostname) {
        hostnames[hostname] = ip;
    }
});

const downloading: DownloadingCallbacks = {};
const cache: ResponseCache = {};

/**
 * Checks if a destination is currently being downloaded.
 */
function isDownloading(dest: string, cb?: (err?: Error | string | null) => void): boolean {
    const current: Array<(err?: Error | string | null) => void> | undefined = downloading[dest];
    if (current && Array.isArray(current)) {
        if (cb) {
            current.push(cb);
        }
        return true;
    }
    return false;
}

/**
 * Downloads a file from the given options and saves it to dest.
 */
const download = function (options: http.RequestOptions, dest: string, cb: (err?: Error | string | null) => void): void {

    if (isDownloading(dest, cb)) {
        return;
    }

    downloading[dest] = [];

    const filename: string = path.basename(dest);
    const file: fs.WriteStream = fs.createWriteStream(dest);

    function done(err?: Error | string | null): void {
        const callbacks: Array<(err?: Error | string | null) => void> = downloading[dest] || [];
        for (let i: number = 0; i < callbacks.length; i++) {
            const callback: (err?: Error | string | null) => void = callbacks[i];
            callback(err);
        }
        delete downloading[dest];
        cb(err);
    }

    const request: http.ClientRequest = http.request(options, (response: http.IncomingMessage): void => {
        let dataLength: number = 0;
        const contentLengthHeader: string | undefined = response.headers["content-length"];
        const contentLength: number = Number(contentLengthHeader || '0');

        response.on('data', (chunk: Buffer): void => {
            dataLength += chunk.length;
        }).pipe(file);

        const hash: crypto.Hash = crypto.createHash('sha1');
        hash.setEncoding('hex');

        response.pipe(hash);

        file.on('finish', (): void => {
            hash.end();
            file.close((closeErr?: Error | null): void => {
                if (contentLength !== dataLength) {
                    fs.unlink(dest, (unlinkErr: Error | null): void => {});
                    done(new HttpError(500, 'length error'));
                } else {
                    console.log(`file downloaded ${filename} ${contentLength} = ${dataLength}`);
                    done();
                }
            });
        });
    });

    request.on('error', (err: Error): void => {
        console.log('http.request err', err);
        fs.unlink(dest, (unlinkErr: Error | null): void => {});
        done(err.message);
    });

    request.end();
};

/**
 * Uploads a file to the response stream.
 */
const upload = function (source: string, stats: fs.Stats, stream: http.ServerResponse): void {
    const ext: string = path.extname(source);
    const contentType: string | null = mime.getType(ext);
    stream.writeHead(200, {
        "content-length": stats.size,
        "content-type": contentType || 'application/octet-stream'
    });
    const readStream: fs.ReadStream = fs.createReadStream(source);
    readStream.pipe(stream);
};

const proxy: http.Server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse): void => {
    const urlStr: string = req.url || '';
    const pathnameParts: string[] = urlStr.split('/');
    const filename: string = pathnameParts.pop() || '';
    const pathname: string = pathnameParts.join('/');

    const host: string = req.headers.host || '';
    const dir: string = path.join('./files', host, pathname);
    const fullPath: string = path.join('./files', host, pathname, filename);

    if (!hostnames[host]) {
        res.end(host);
        return;
    }

    const options: http.RequestOptions = {
        hostname: hostnames[host],
        port: 80,
        path: req.url,
        method: req.method,
        headers: req.headers
    };

    const cacheExtensions: string[] = ['.deb', '.udeb', '.iso', '.apk', '.tar.xz', '.tar.gz', 'rke_linux-amd64'];
    const shouldCache: boolean = cacheExtensions.some((v: string): boolean => filename.includes(v));

    if (shouldCache) {
        const onDownload = (err?: Error | string | null): void => {
            if (err) {
                console.log('download err', err);
                res.writeHead(500);
                res.end();
            } else {
                fs.stat(fullPath, (statErr: Error | null, stats: fs.Stats): void => {
                    if (statErr) {
                        res.writeHead(500);
                        res.end();
                    } else {
                        upload(fullPath, stats, res);
                    }
                });
            }
        };

        if (isDownloading(fullPath, onDownload)) {
            return;
        }

        fs.stat(fullPath, (statErr: Error | null, stats: fs.Stats): void => {
            if (statErr) {
                fse.ensureDir(dir, (dirErr: Error | null): void => {
                    if (dirErr) {
                        res.writeHead(500);
                        res.end();
                    } else {
                        download(options, fullPath, onDownload);
                    }
                });
            } else {
                console.log(`file cached ${filename} ${stats.size}`);
                upload(fullPath, stats, res);
            }
        });
    } else {
        // Keeping original logic including the 'false &&' part
        if (false && (filename === 'InRelease' || filename === 'Release')) {
            const cacheKey: string = req.url || '';
            const buf: Buffer | undefined = cache[cacheKey];
            if (buf !== undefined && buf !== null) {
                res.writeHead(200, {
                    'content-length': buf.length
                });
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
                    cache[cacheKey] = Buffer.concat(bufs);
                    setTimeout((): void => {
                        delete cache[cacheKey];
                    }, 60 * 1000);
                });
            });
            get.once('error', (): void => {
                res.end();
            });
            get.end();
            return;
        }

        const get: http.ClientRequest = http.request(options, (_res: http.IncomingMessage): void => {
            const statusCode: number = _res.statusCode || 200;
            res.writeHead(statusCode, _res.headers);
            _res.pipe(res);
        });
        get.once('error', (): void => {
            res.end();
        });
        get.end();
    }
});

proxy.listen(9080, (): void => {
    console.log('Proxy listening on port 9080');
});
