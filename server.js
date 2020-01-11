const http = require('http');
const net = require('net');
const url = require('url');
const fs = require('fs');
const path = require('path');
const fse = require('fs-extra');
const mime = require('mime');

// redis-cli -a vLDuwCd2PMI0VkNZBokcziq3pxHxZdUH rpush A:download.docker.com '{"name":"download.docker.com","ttl":1000,"data":"10.0.0.3"}'

const hostnames = {
    'ubuntu.archive.nodetopia.xyz': '192.175.120.167',
    'debian.archive.nodetopia.xyz': '192.175.120.168',
    'alpine.archive.nodetopia.xyz': '208.74.142.61'
};

let downloading = {};
let cache = {};

function isDownloading(dest, cb) {
    if (downloading[dest] && Array.isArray(downloading[dest])) {
        cb && downloading[dest].push(cb);
        return true;
    }
    return false
}

let download = function (options, dest, cb) {

    if (isDownloading(dest, cb)) {
        return;
    }

    downloading[dest] = [];

    let filename = dest.split('/').pop();

    let file = fs.createWriteStream(dest);

    function done(err) {
        for (let i = 0; i < downloading[dest].length; i++) {
            downloading[dest][i](err)
        }
        delete downloading[dest];
        cb(err);
    }


    let request = http.request(options, function (response) {
        let dataLength = 0;
        let contentLength = Number(response.headers["content-length"]);

        response.on('data', function (chunk) {
            dataLength += chunk.length;
            // console.log('response data', chunk.length)
        }).pipe(file);
        file.on('finish', function () {
            file.close(function () {
                if (contentLength != dataLength) {
                    fs.unlink(dest); // Delete the file async. (But we don't check the result)
                    done(new Error('length error'));
                } else {
                    console.log(`file downloaded ${filename} ${contentLength} = ${dataLength}`)
                    done();
                }
            });  // close() is async, call cb after close completes.
        });
    }).on('error', function (err) { // Handle errors
        console.log('http.request err', err)

        fs.unlink(dest); // Delete the file async. (But we don't check the result)
        done(err.message);
    });
    request.end()
};

let upload = function (source, stats, stream) {
    stream.writeHead(200, {
        "content-length": stats.size,
        "content-type": mime.getType(path.extname(source))
    });
    fs.createReadStream(source).pipe(stream);
}

const proxy = http.createServer((req, res) => {

    let pathname = req.url.split('/');
    let filename = pathname.pop();
    pathname = pathname.join('/');

    const dir = path.join(__dirname, req.headers.host, pathname);

    let fullPath = path.join(__dirname, req.headers.host, pathname, filename);



    if (!hostnames[req.headers.host]) {
        res.end(req.headers.host);
    }
    const options = {
        hostname: hostnames[req.headers.host],
        port: 80,
        path: req.url,
        method: req.method,
        headers: req.headers
    };


    if (['.deb', '.udeb', '.iso', '.apk'].includes(path.extname(filename))) {

        let onDownload = function(err) {
            if (err) {
                console.log('download err', err)
                res.writeHead(500);
                res.end();
            } else {
                fs.stat(fullPath, function (err, stats) {
                    upload(fullPath, stats, res);
                });
            }
        }

        if (isDownloading(fullPath, onDownload)) {

            return;
        }
        fs.stat(fullPath, function (err, stats) {
            if (err) {
                fse.ensureDir(dir, function (err) {
                    download(options, fullPath, onDownload)
                })
            } else {
                console.log(`file cached ${filename} ${stats.size}`)
                upload(fullPath, stats, res)
            }
        });
    } else {
        if (false && filename == 'InRelease' || filename == 'Release') {
            console.log(filename)
            if (cache[req.url]) {
                res.writeHead(200, {
                    'content-length': cache[req.url].length
                });
                return res.end(cache[req.url]);
            }

            console.log(`http://${req.headers.host}${req.url}`)
            const get = http.request(options, (_res) => {
                //console.log(`STATUS: ${_res.statusCode}`);
                //console.log(`HEADERS: ${JSON.stringify(_res.headers)}`);
                res.writeHead(_res.statusCode, _res.headers);
                _res.pipe(res)
                let bufs = [];
                _res.on('data', function (d) { bufs.push(d); });
                _res.on('end', function () {
                    cache[req.url] = Buffer.concat(bufs);
                    setTimeout(function () {
                        delete cache[req.url];

                    }, 60 * 1000);
                })
            });
            return get.end();
        }

        console.log(`http://${req.headers.host}${req.url}`)
        const get = http.request(options, (_res) => {
            //console.log(`STATUS: ${_res.statusCode}`);
            //console.log(`HEADERS: ${JSON.stringify(_res.headers)}`);
            res.writeHead(_res.statusCode, _res.headers);
            _res.pipe(res)

        });
        get.end();
    }

});

proxy.listen(8080);