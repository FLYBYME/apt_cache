"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const http = __importStar(require("http"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const fse = __importStar(require("fs-extra"));
const mime = __importStar(require("mime"));
const crypto = __importStar(require("crypto"));
/**
 * Custom error class for HTTP related errors.
 */
class HttpError extends Error {
    statusCode;
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'HttpError';
    }
}
const hostnames = {};
const hostsEnv = process.env.HOSTS || '';
hostsEnv.split('!').forEach((str) => {
    const parts = str.split(',');
    const hostname = parts[0];
    const ip = parts[1];
    if (hostname) {
        hostnames[hostname] = ip;
    }
});
const downloading = {};
const cache = {};
/**
 * Checks if a destination is currently being downloaded.
 */
function isDownloading(dest, cb) {
    const current = downloading[dest];
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
const download = function (options, dest, cb) {
    if (isDownloading(dest, cb)) {
        return;
    }
    downloading[dest] = [];
    const filename = path.basename(dest);
    const file = fs.createWriteStream(dest);
    function done(err) {
        const callbacks = downloading[dest] || [];
        for (let i = 0; i < callbacks.length; i++) {
            const callback = callbacks[i];
            callback(err);
        }
        delete downloading[dest];
        cb(err);
    }
    const request = http.request(options, (response) => {
        let dataLength = 0;
        const contentLengthHeader = response.headers["content-length"];
        const contentLength = Number(contentLengthHeader || '0');
        response.on('data', (chunk) => {
            dataLength += chunk.length;
        }).pipe(file);
        const hash = crypto.createHash('sha1');
        hash.setEncoding('hex');
        response.pipe(hash);
        file.on('finish', () => {
            hash.end();
            file.close((closeErr) => {
                if (contentLength !== dataLength) {
                    fs.unlink(dest, (unlinkErr) => { });
                    done(new HttpError(500, 'length error'));
                }
                else {
                    console.log(`file downloaded ${filename} ${contentLength} = ${dataLength}`);
                    done();
                }
            });
        });
    });
    request.on('error', (err) => {
        console.log('http.request err', err);
        fs.unlink(dest, (unlinkErr) => { });
        done(err.message);
    });
    request.end();
};
/**
 * Uploads a file to the response stream.
 */
const upload = function (source, stats, stream) {
    const ext = path.extname(source);
    const contentType = mime.getType(ext);
    stream.writeHead(200, {
        "content-length": stats.size,
        "content-type": contentType || 'application/octet-stream'
    });
    const readStream = fs.createReadStream(source);
    readStream.pipe(stream);
};
const proxy = http.createServer((req, res) => {
    const urlStr = req.url || '';
    const pathnameParts = urlStr.split('/');
    const filename = pathnameParts.pop() || '';
    const pathname = pathnameParts.join('/');
    const host = req.headers.host || '';
    const dir = path.join('./files', host, pathname);
    const fullPath = path.join('./files', host, pathname, filename);
    if (!hostnames[host]) {
        res.end(host);
        return;
    }
    const options = {
        hostname: hostnames[host],
        port: 80,
        path: req.url,
        method: req.method,
        headers: req.headers
    };
    const cacheExtensions = ['.deb', '.udeb', '.iso', '.apk', '.tar.xz', '.tar.gz', 'rke_linux-amd64'];
    const shouldCache = cacheExtensions.some((v) => filename.includes(v));
    if (shouldCache) {
        const onDownload = (err) => {
            if (err) {
                console.log('download err', err);
                res.writeHead(500);
                res.end();
            }
            else {
                fs.stat(fullPath, (statErr, stats) => {
                    if (statErr) {
                        res.writeHead(500);
                        res.end();
                    }
                    else {
                        upload(fullPath, stats, res);
                    }
                });
            }
        };
        if (isDownloading(fullPath, onDownload)) {
            return;
        }
        fs.stat(fullPath, (statErr, stats) => {
            if (statErr) {
                fse.ensureDir(dir, (dirErr) => {
                    if (dirErr) {
                        res.writeHead(500);
                        res.end();
                    }
                    else {
                        download(options, fullPath, onDownload);
                    }
                });
            }
            else {
                console.log(`file cached ${filename} ${stats.size}`);
                upload(fullPath, stats, res);
            }
        });
    }
    else {
        // Keeping original logic including the 'false &&' part
        if (false && (filename === 'InRelease' || filename === 'Release')) {
            const cacheKey = req.url || '';
            const buf = cache[cacheKey];
            if (buf instanceof Buffer) {
                res.writeHead(200, {
                    'content-length': buf.length
                });
                res.end(buf);
                return;
            }
            console.log(`http://${host}${req.url}`);
            const get = http.request(options, (_res) => {
                const statusCode = _res.statusCode || 200;
                res.writeHead(statusCode, _res.headers);
                _res.pipe(res);
                const bufs = [];
                _res.on('data', (d) => { bufs.push(d); });
                _res.on('end', () => {
                    cache[cacheKey] = Buffer.concat(bufs);
                    setTimeout(() => {
                        delete cache[cacheKey];
                    }, 60 * 1000);
                });
            });
            get.once('error', () => {
                res.end();
            });
            get.end();
            return;
        }
        const get = http.request(options, (_res) => {
            const statusCode = _res.statusCode || 200;
            res.writeHead(statusCode, _res.headers);
            _res.pipe(res);
        });
        get.once('error', () => {
            res.end();
        });
        get.end();
    }
});
proxy.listen(9080, () => {
    console.log('Proxy listening on port 9080');
});
