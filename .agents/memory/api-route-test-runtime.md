---
name: API route test runtime
description: Runtime limitation when Node's native TypeScript stripping loads workspace TypeScript packages.
---

Node's native TypeScript stripping does not resolve extensionless imports the same way the workspace's TypeScript bundler does. For route tests importing workspace packages, bundle the test entry with esbuild before using Node's test runner. Also, build the API server's TypeScript project references before relying on a direct API-server typecheck; stale declaration output can make workspace exports appear missing.

**Why:** The API package imports shared workspace schemas whose TypeScript source uses extensionless imports; direct Node tests fail before route assertions run. Its project-reference declarations can also lag behind current workspace source.

**How to apply:** When adding API tests that import routes or workspace packages, follow the existing API test script's bundling approach instead of importing those modules directly with native type stripping. For standalone API typechecks, run `tsc -b artifacts/api-server/tsconfig.json` first to refresh referenced declarations.
