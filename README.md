# flybyme/apt_cache

## Project Overview
**Version:** c7384f0  
**Description:** This app does one little thing, and does it well.

## Dependencies and Build Tools
- `dhcp`: `git+https://github.com/infusion/node-dhcp.git`
- `fs-extra`: `^8.1.0`
- `last-one-wins`: `^1.0.4`
- `mime`: `^2.4.4`
- `tftp`: `^0.1.2`

## Server Setup, API Endpoints, and Middleware

### Server Setup (Native HTTP / No Express)
The application is built using the native Node.js `http` and `net` modules (`http.createServer`) rather than Express. It acts as a transparent caching proxy server.

### Middleware
- Parses the `HOSTS` environment variable to create a mapping of hostnames to IP addresses.
- Prevents concurrent duplicate downloads using a state tracking object.
- Validates file content lengths to ensure download integrity.

### API Endpoints
- **Proxy Endpoint (`/*`)**: Intercepts requests and caches specific file extensions locally (`.deb`, `.udeb`, `.iso`, `.apk`, `.tar.xz`, `.tar.gz`, `rke_linux-amd64`) before uploading them to the requester.
  - **Redis Context:** `// redis-cli -a vLDuwCd2PMI0VkNZBokcziq3pxHxZdUH rpush A:download.docker.com '{"name":"download.docker.com","ttl":1000,"data":"10.0.0.3"}'`
  - **Hashing:** `// read all file and pipe it (write it) to the hash object`
  - **Hash Output:** `// console.log(hash.read()); // the desired sha1sum`
  - **File Closure:** `// close() is async, call cb after close completes.`
  - **Error Deletion:** `// Delete the file async. (But we don't check the result)`
  - **Error Handling:** `// Handle errors`

## Installation
npm