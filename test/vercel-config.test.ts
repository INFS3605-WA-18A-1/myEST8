import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

// Vercel refuses a vercel.json it can't accept only when production deploys, after the tests have passed.
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const includeFiles: string = vercel.functions['api/index.ts'].includeFiles;

describe("the Vercel function's includeFiles", () => {
  test('is at most 256 characters, the most Vercel accepts', () => {
    expect(includeFiles.length).toBeLessThanOrEqual(256);
  });

  test('names every font package the app serves from node_modules', () => {
    const fonts = Object.keys(pkg.dependencies).filter((name) => name.startsWith('@fontsource'));
    expect(fonts.length).toBeGreaterThan(0);
    // The packages may share a brace group ("@fontsource-variable/{a,b}"), so the scope and the name are checked apart.
    for (const font of fonts) {
      const [scope, name] = font.split('/');
      expect(includeFiles).toContain(`${scope}/`);
      expect(includeFiles).toContain(name);
    }
  });
});
