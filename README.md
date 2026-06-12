# apt_cache

> A lightweight, TypeScript‑based HTTP proxy and caching layer for Debian packages and related artefacts.

## Overview
`apt_cache` is a small server that proxies requests for package files (```.deb```, ```.udeb``` etc.) from upstream mirrors while transparently caching them locally. The cached files are served directly to clients, reducing bandwidth usage and speeding up subsequent downloads.

Key features:
- **Host‑level mapping** via an environment variable – map a domain name to the IP of your mirror.
- **Concurrent download handling** – a request for the same file that is already being fetched will receive a `503` until the download finishes.
- **TypeScript safety** – all public APIs are strongly typed, making integration straightforward in other projects.

## Installation & Setup
```bash
# npm package (if published)
npm install apt-cache
```

For local development or when using the source directly:
```bash
git clone https://github.com/flybyme/apt_cache.git
cd apt_cache
npm install
```

The project uses a **host mapping string** of the form:
```
<hostname>,<ip>!<hostname2>,<ip2>!...```
Set it via an environment variable named `APACHE_HOSTS`. Example:
```bash
export APACHE_HOSTS="example.com,192.0.2.1" 
```

## Basic Usage Example (Node.js)
```ts
import * as http from 'http';
import { CacheManager } from './src/cache_manager';
import { HttpProxyService } from './src/proxy_service';

const cacheMgr = new CacheManager(process.env.APACHE_HOSTS ?? "");
const proxySrv = new HttpProxyService(cacheMgr);

const server = http.createServer(proxySrv.createServerHandler());
server.listen(8080, () => console.log('apt_cache running on port 8080'));
```

> The example assumes you have a working mirror reachable at the IP specified in `APACHE_HOSTS`.

## API Reference Summary
- **CacheManager** – Handles download orchestration and file serving.  See [API reference](docs/api_reference.md).
- **HttpProxyService** – Creates an HTTP handler that performs caching logic before proxying to upstream mirrors.

For a deeper dive into method signatures, consult the documentation in `docs/api_reference.md`.

## Contribution Guidelines
See our detailed guide: [Contributing](docs/contributing.md)

## License
This project is licensed under the MIT license – see the [LICENSE](LICENSE) file for details.
