import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// src/web/static/tw.css is built from the templates and committed, so production serves it
// as is. A utility class added without `npm run css` would be missing there: this catches it.
test('the committed Tailwind CSS matches what the templates need (run `npm run css` if not)', () => {
  const built = execFileSync('npx', ['tailwindcss', '-i', 'src/web/tailwind.css', '--minify'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  expect(built.trim()).toBe(readFileSync('src/web/static/tw.css', 'utf8').trim());
});
