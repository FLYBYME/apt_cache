import * as http from 'http';
import * as net from 'net';
import * as url from 'url';
import * as fs from 'fs';
import * as path from 'path';
import * as fse from 'fs-extra';
import * as mime from 'mime';
import * as crypto from 'crypto';

// redis-cli -a vLDuwCd2PMI0VkNZBokcziq3pxHxZdUH rpush A:download.docker.com '{"name":"download.docker.com","ttl":1000,"data":"10.0.0.3"}'

interface DownloadOptions {
    filePath: string;
    cacheDir: string;
    timeout: number;
}

interface FileStats {
    size: number;
    modifiedTime: Date;
}

interface Response extends http.ServerResponse {
    status: number;
    data: any;
}

const hostnames: { [key: string]: string } = {};

(process.env.HOSTS || '').split('!').forEach((str: string): void => {
    if (!str) return;
    const hostname: string = str.split(',')[0];
    const ip: string = str.split(',')[1];
    if (hostname && ip) {
        hostnames[hostname] = ip;
    }
});

let downloading: { [key: string]: ((err?: Error) => void)[] } = {};
let cache: { [key: string]: any } = {};

function isDownloading(dest: string, cb?: (err?: Error) => void): boolean {
    if (downloading[dest] && Array.isArray(downloading[dest])) {
        if (cb) downloading[dest].push(cb);
        return true;
    }
    return false;
}

async function downloadFile(options: DownloadOptions): Promise<FileStats> {
    return new Promise<FileStats>((resolve: (value: FileStats) => void, reject: (reason: Error) => void): void => {
        const dest: string = options.filePath;

        try {
            if (!dest || dest.trim() === '') {
                throw new Error("Invalid path");
            }
        } catch (e: unknown) {
            reject(e instanceof Error ? e : new Error("Invalid path"));
            return;
        }

        if (isDownloading(dest, (err?: Error): void => {
            if (err) {
                reject(err);
            } else {
                resolveStats();
            }
        })) {
            return;
        }

        downloading[dest] = [];

        let filename: string = dest.split('/').pop() || '';
        let file: fs.WriteStream;

        try {
            fse.ensureDirSync(options.cacheDir);
            file = fs.createWriteStream(dest);
        } catch (err: unknown) {
            delete downloading[dest];
            reject(err instanceof Error ? err : new Error("File access error"));
            return;
        }

        function done(err?: Error): void {
            const callbacks: ((e?: Error) => void)[] = downloading[dest] || [];
            for (let i: number = 0; i < callbacks.length; i++) {
                callbacks[i](err);
            }
            delete downloading[dest];
            
            if (err) {
                reject(err);
            } else {
                resolveStats();
            }
        }

        function resolveStats(): void {
            fs.stat(dest, (err: NodeJS.ErrnoException | null, stats: fs.Stats): void => {
                if (err) {
                    reject(new Error("File access error"));
                } else {
                    resolve({
                        size: stats.size,
                        modifiedTime: stats.mtime
                    });
                }
            });
        }

        let request: http.ClientRequest = http.request(dest, function (response: http.IncomingMessage): void {
            let dataLength: number = 0;
            let contentLength: number = Number(response.headers["content-length"]) || 0;

            response.on('data', function (chunk: Buffer): void {
                dataLength += chunk.length;
                // console.log('response data', chunk.length)
            }).pipe(file);
            
            let hash: crypto.Hash = crypto.createHash('sha1');
            hash.setEncoding('hex');

            // read all file and pipe it (write it) to the hash object
            response.pipe(hash);
            file.on('finish', function (): void {
                hash.end();
                // console.log(hash.read()); // the desired sha1sum
                file.close(function (): void {
                    if (contentLength !== 0 && contentLength !== dataLength) {
                        fs.unlink(dest, (): void => {}); // Delete the file async. (But we don't check the result)
                        done(new Error('length error'));
                    } else {
                        console.log(`file downloaded ${filename} ${contentLength} = ${dataLength}`);
                        done();
                    }
                });  // close() is async, call cb after close completes.
            });
        }).on('error', function (err: Error): void { // Handle errors
            console.log('http.request err', err);

            fs.unlink(dest, (): void => {}); // Delete the file async. (But we don't check the result)
            done(err);
        });

        request.setTimeout(options.timeout, function(): void {
            request.destroy();
            done(new Error("Timeout error"));
        });

        request.end();
    });
}

let upload = function (source: string, stats: fs.Stats, stream: Response): void {
    const ext: string = path.extname(source);
    const contentType: string = mime.getType(ext) || 'application/octet-stream';
    stream.writeHead(200, {
        "content-length": stats.size,
        "content-type": contentType
    });
    fs.createReadStream(source).pipe(stream);
}

const proxy: http.Server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse): void => {
    const response: Response = res as Response;

    let pathnameArray: string[] = (req.url || '').split('/');
    let filename: string = pathnameArray.pop() || '';
    let pathname: string = pathnameArray.join('/');

    const host: string = req.headers.host || '';
    const dir: string = path.join('./files', host, pathname);

    let fullPath: string = path.join('./files', host, pathname, filename);

    if (!hostnames[host]) {
        response.end(host);
    }
    const options: http.RequestOptions = {
        hostname: hostnames[host],
        port: 80,
        path: req.url,
        method: req.method,
        headers: req.headers
    };
    //console.log(pathname, filename,options)

    if (['.deb', '.udeb', '.iso', '.apk', '.tar.xz', '.tar.gz', 'rke_linux-amd64'].some((v: string): boolean => filename.includes(v))) {

        let onDownload = function (err?: Error): void {
            if (err) {
                console.log('download err', err);
                response.writeHead(500);
                response.end();
            } else {
                fs.stat(fullPath, function (err: NodeJS.ErrnoException | null, stats: fs.Stats): void {
                    if (!err) {
                        upload(fullPath, stats, response);
                    }
                });
            }
        };
    }
});