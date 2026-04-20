// Side-effect import declaration for CSS files.
// TypeScript 6.0 tightened module-resolution requirements and rejects
// bare `import "./globals.css"` without a corresponding declaration.
declare module "*.css";
