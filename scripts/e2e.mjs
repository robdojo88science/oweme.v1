// Node's native TypeScript loader avoids Playwright's legacy ESM transform on Node 24.
process.env.PW_DISABLE_TS_ESM = '1';
await import('../node_modules/@playwright/test/cli.js');
