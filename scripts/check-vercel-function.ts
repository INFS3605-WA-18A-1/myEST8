// Checks the Vercel function that `vercel build` made holds every file the app reads
// from disk at run time: the files /assets/* serves and the Phosphor icons. Vercel only
// bundles what it can trace or what vercel.json's includeFiles names, and a file left
// out is a 404 or a crash in production while every test passes. CI's `build` job runs
// this after `vercel build`; locally:
//
//   npx vercel build --prod && npx tsx scripts/check-vercel-function.ts

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { servedFiles } from '../src/web/assets.ts';

const root = process.cwd();
const fn = join(root, '.vercel/output/functions/api/index.func');
const config = join(fn, '.vc-config.json');
if (!existsSync(config)) {
  console.error(`No built function at ${relative(root, fn)}. Run \`npx vercel build --prod\` first.`);
  process.exit(1);
}

// A prebuilt function points at files in the repository through filePathMap, or holds its own copy.
const filePathMap: Record<string, string> = JSON.parse(readFileSync(config, 'utf8')).filePathMap ?? {};
const bundled = (path: string) => Object.hasOwn(filePathMap, path) || existsSync(join(fn, path));

// src/web/icons.ts reads any icon by name, so the whole of Phosphor's assets folder has to be there.
const require = createRequire(import.meta.url);
const icons = join(dirname(require.resolve('@phosphor-icons/core')), '..', 'assets');

const needed = [...servedFiles(), ...readdirSync(icons, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name))];
const missing = needed.map((file) => relative(root, file)).filter((path) => !bundled(path));

if (missing.length) {
  console.error(`The Vercel function is missing ${missing.length} of the ${needed.length} files the app reads at run time:`);
  for (const path of missing.slice(0, 20)) console.error(`  ${path}`);
  if (missing.length > 20) console.error(`  and ${missing.length - 20} more`);
  console.error("Add them to includeFiles in vercel.json (at most 256 characters; use {a,b} groups).");
  process.exit(1);
}
console.log(`The Vercel function holds all ${needed.length} files the app reads at run time.`);
