// Empty stand-in for the `server-only` package. The real package throws
// when imported outside a React Server Component context — that guard is
// valuable inside the Next.js bundle but meaningless for a Node CLI
// script that genuinely runs server-side. See
// scripts/_register.cjs for how it's wired up.
module.exports = {};
