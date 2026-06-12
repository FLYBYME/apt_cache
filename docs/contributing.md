# Contributing

We welcome contributions from the community! Follow these guidelines to get started.

## Fork & Branch
1. **Fork** the repository on GitHub.
2. Create a new branch that reflects your feature or bug fix:
   ```bash
   git checkout -b feature/<short-description>
   ```

## Development Setup
```bash
# Clone your fork and navigate into it
git clone https://github.com/<your-username>/apt_cache.git
cd apt_cache

# Install dependencies (Node 20+ required)
npm install
```

### Build & Run
The project is written in TypeScript. After changes, compile:
```bash
npm run build   # or npm run dev for watch mode
```
Run the example server:
```bash
node --loader ts-node/esm start.ts
```

## Code Style & Linting
- **Prettier** enforces a consistent code style.
- **ESLint** (with TypeScript support) catches common issues.
- Run both automatically with:
  ```bash
  npm run lint    # lints the source files
  npm run format  # formats via Prettier
  ```

### Commit Messages
We use Conventional Commits. Format: `type(scope?): subject`. Example:
```
feat(cache): add support for .tgz caching
fix(proxy): avoid race condition on concurrent downloads
```

## Tests
All tests are located under the `__tests__` directory and run with Jest.
```bash
npm test          # runs all tests once
npm test --watch  # watches files and reruns
```
**Coverage** is checked by the CI. Aim for at least **80 %** overall.

## Continuous Integration
GitHub Actions are configured in `.github/workflows/ci.yml`. The workflow:
- Installs dependencies
- Builds the project
- Runs linting, formatting checks, and tests
- Builds a Docker image (optional) if CI passes.

Make sure your PR does not break any of these steps. The CI will automatically comment on the pull request.

## Pull Request Process
1. Push your branch to your fork:
   ```bash
   git push origin feature/<short-description>
   ```
2. Open a PR against `main` and reference issue #73 if applicable.
3. Add a concise description, link any related issues or docs updates.
4. Await reviews; address feedback promptly.

## Security & Maintenance
- Keep dependencies up to date. Run:
  ```bash
  npm audit fix --force
  ```
- If you discover a vulnerability, open an issue with the steps to reproduce and potential mitigations.

---
> **Tip** – Use `npm run type-check` to confirm TypeScript correctness before pushing.
