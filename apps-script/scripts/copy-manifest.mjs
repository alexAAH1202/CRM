// clasp v3 no longer transpiles TypeScript, so we compile with tsc into dist/
// and push dist/ (see .clasp.json.example "rootDir").
import { copyFileSync } from 'node:fs';
copyFileSync(
  new URL('../appsscript.json', import.meta.url),
  new URL('../dist/appsscript.json', import.meta.url),
);
