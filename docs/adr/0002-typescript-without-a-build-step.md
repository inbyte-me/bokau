# 0002: Strict TypeScript, run directly by Node

**Context.** Everything should be TypeScript, without slowing the edit-run loop or adding a build per package.

**Decision.** All code is TypeScript under `strict` (plus `noImplicitOverride`, `verbatimModuleSyntax`,
`erasableSyntaxOnly`). Node 24 strips types natively, so server code, scripts and tests run from `.ts` source;
packages export `src/*.ts`. TypeScript 7 (the native compiler) only type-checks (`noEmit`). Vite bundles the web app;
esbuild bundles the Electron main process (Electron does not strip types). Tests may leave fixture locals untyped
(`tsconfig.test.json`); application code may not.

**Consequences.** No `dist/` in packages, no source maps to chase, instant restarts. Only erasable syntax is allowed
(no enums, namespaces, parameter properties), and relative imports carry `.ts`. Type errors do not stop `node`
from running; `pnpm typecheck` (and CI) is the gate.
