# Apt Cache Project

This repository contains a lightweight HTTP‑style cache for network resources.

## Lock file

The project relies on **`package-lock.json`** (or `npm-shrinkwrap.json`) so that the CI pipeline can perform deterministic dependency installation with `npm ci`.  A lock file guarantees:

* Exact, reproducible versions of all dependencies listed in `package.json`.
* Faster and more reliable CI builds by skipping the version‑resolution step.
* Prevention of accidental upgrades caused by caret (`^`) ranges when a new release of a dependency is published.

### Generating / updating the lock file

Whenever you modify `dependencies` or `devDependencies` in *package.json*, regenerate the lock file:

```bash
# Clean any previous installations
rm -rf node_modules package-lock.json

# Resolve all dependencies according to the current package.json
npm install

# Commit the new lock file
git add package-lock.json
git commit -m "Update package‑lock for CI dependency resolution"
```

> **Tip:**  Run `npm ci` in a clean environment (e.g., a fresh Docker container) to verify that the lock file installs all dependencies correctly.

### Keeping it up‑to‑date
* If you manually edit *package.json*, run `npm install` again before pushing.
* Never commit an out‑of‑sync or missing lock file – CI will fail with “no supported dependency lock file found”.

## Running the tests locally
```bash
npm ci   # installs dependencies from package-lock.json
npm run build  # compiles TypeScript
npm test        # runs jest with coverage
```
