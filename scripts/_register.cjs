// Preload hook for Node CLI scripts that import app code. Two jobs:
//  1. Intercept the module resolver so `import "server-only"` resolves
//     to an empty stub instead of throwing (the real package is a
//     client-bundle guard, irrelevant for Node scripts that run on the
//     server anyway).
//  2. Load `.env.local` + `.env` before any import resolves — ESM hoists
//     imports above top-level code, so the script can't reliably call
//     dotenv itself before `@/lib/db/client` evaluates env vars.
//
// Usage in package.json scripts:
//   tsx --require ./scripts/_register.cjs scripts/<name>.ts

const Module = require("node:module");
const path = require("node:path");

// Env loading — Next.js convention is .env.local, fallback .env.
require("dotenv").config({ path: path.resolve(process.cwd(), ".env.local") });
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });

const STUB = path.resolve(__dirname, "_shims/server-only.cjs");
const origResolve = Module._resolveFilename;

Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "server-only") {
    return STUB;
  }
  return origResolve.call(this, request, parent, ...rest);
};
