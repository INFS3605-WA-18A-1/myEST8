// Builds dist/ for the design-sync converter from the real src/web/ui.ts:
//   dist/index.js     ESM, React external, ui.ts + hono/html + Phosphor icons inlined
//   dist/**/*.d.ts    per-file declarations (isolatedDeclarations)
//   dist/styles.css   daisyUI + app.css + Tailwind utilities compiled from the repo's markup
//   dist/fonts/       the Barlow woff2s app.css names
// Run from anywhere: `npm --prefix .design-sync/react run build`.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import ts from 'typescript';

const PKG = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(PKG, '../..');
const SRC = join(PKG, 'src');
const DIST = join(PKG, 'dist');
const CACHE = join(PKG, '.cache');
const repoRequire = createRequire(join(REPO, 'package.json'));
const sh = (cmd, args) => execFileSync(cmd, args, { cwd: PKG, stdio: 'inherit' });

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
mkdirSync(CACHE, { recursive: true });

// 1. Type-check the wrappers against ui.ts (parity.ts fails on a drifted union).
sh(join(PKG, 'node_modules/.bin/tsc'), ['-p', PKG]);

// 2. The Tailwind theme ui.ts puts in every page's <head>, read from its source so it can't drift.
const uiSource = readFileSync(join(REPO, 'src/web/ui.ts'), 'utf8');
const themeMatch = /const TAILWIND_THEME = html`<style type="text\/tailwindcss">([\s\S]*?)<\/style>`;/.exec(uiSource);
if (!themeMatch) throw new Error('TAILWIND_THEME not found in src/web/ui.ts');
const tailwindTheme = themeMatch[1].trim();

// 3. Phosphor icons for the browser. icons.ts reads each SVG with readFileSync(require.resolve(...));
// in the bundle those resolve against a map of every regular icon plus the other
// weights the app's source asks for.
const phosphor = join(REPO, 'node_modules/@phosphor-icons/core');
const svgBody = (file) => readFileSync(file, 'utf8').replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const icons = {};
for (const file of readdirSync(join(phosphor, 'assets/regular'))) {
  icons[`@phosphor-icons/core/assets/regular/${file}`] = `<svg>${svgBody(join(phosphor, 'assets/regular', file))}</svg>`;
}
const appSources = execFileSync('git', ['ls-files', 'src'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.ts'));
for (const f of appSources) {
  if (!existsSync(join(REPO, f))) continue;
  for (const m of readFileSync(join(REPO, f), 'utf8').matchAll(/icon\('([a-z0-9-]+)',\s*\{[^}]*weight:\s*'([a-z]+)'/g)) {
    const [, name, weight] = m;
    if (weight === 'regular') continue;
    const file = `${name}-${weight}.svg`;
    icons[`@phosphor-icons/core/assets/${weight}/${file}`] = `<svg>${svgBody(join(phosphor, 'assets', weight, file))}</svg>`;
  }
}
const iconsShim = {
  name: 'phosphor-shim',
  setup(build) {
    build.onResolve({ filter: /^node:(fs|module)$/ }, (args) => {
      if (!args.importer.endsWith(join('src', 'web', 'icons.ts'))) return undefined;
      return { path: args.path, namespace: 'phosphor-shim' };
    });
    build.onLoad({ filter: /.*/, namespace: 'phosphor-shim' }, (args) => ({
      loader: 'js',
      contents:
        args.path === 'node:fs'
          ? `const ICONS = ${JSON.stringify(icons)};
export function readFileSync(path) {
  const svg = ICONS[path];
  if (svg === undefined) throw new Error('No such icon: ' + path);
  return svg;
}`
          : `export function createRequire() { return { resolve: (spec) => spec }; }`,
    }));
  },
};

// 4. The ESM entry the converter re-bundles.
await esbuild.build({
  entryPoints: [join(SRC, 'index.ts')],
  outfile: join(DIST, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
  define: { __TAILWIND_THEME__: JSON.stringify(tailwindTheme) },
  plugins: [iconsShim],
  legalComments: 'inline',
  logLevel: 'warning',
});

// 5. Declarations, one per source file, with import specifiers pointing at the .d.ts siblings.
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const compilerOptions = { declaration: true, isolatedDeclarations: true, jsx: ts.JsxEmit.ReactJSX, allowImportingTsExtensions: true, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 };
for (const file of walk(SRC)) {
  const rel = relative(SRC, file);
  if (rel === 'parity.ts' || rel.startsWith('runtime/')) continue;
  const out = ts.transpileDeclaration(readFileSync(file, 'utf8'), { fileName: file, compilerOptions, reportDiagnostics: true });
  if (out.diagnostics?.length) throw new Error(`${rel}: ${ts.flattenDiagnosticMessageText(out.diagnostics[0].messageText, '\n')}`);
  const dts = out.outputText
    .replace(/from '(\.[^']+)\.tsx?'/g, "from '$1.js'")
    .replace(/^import '\.\/runtime\/init\.ts';\n/m, '');
  mkdirSync(dirname(join(DIST, rel)), { recursive: true });
  writeFileSync(join(DIST, rel.replace(/\.tsx?$/, '.d.ts')), dts);
}

// 6. CSS, in the order a myEST8 page loads it: daisyUI, app.css, then Tailwind's utilities.
const tailwindInput = join(CACHE, 'tailwind-input.css');
writeFileSync(
  tailwindInput,
  `@import "tailwindcss" source(none);
@source "${relative(CACHE, join(REPO, 'src/web'))}/**/*.ts";
@source "${relative(CACHE, SRC)}/**/*.tsx";
@source "${relative(CACHE, join(REPO, '.design-sync/previews'))}/**/*.tsx";
${tailwindTheme}
`,
);
const tailwindOutput = join(CACHE, 'tailwind.css');
sh(join(PKG, 'node_modules/.bin/tailwindcss'), ['-i', tailwindInput, '-o', tailwindOutput]);
const appCss = readFileSync(join(REPO, 'src/web/static/app.css'), 'utf8').replace(/url\('\/assets\/fonts\/([^']+)'\)/g, "url('./fonts/$1')");
writeFileSync(
  join(DIST, 'styles.css'),
  [
    readFileSync(repoRequire.resolve('daisyui/daisyui.css'), 'utf8'),
    '/* src/web/static/app.css */',
    appCss,
    '/* Tailwind utilities used by src/web and the previews (the app generates these in the browser) */',
    readFileSync(tailwindOutput, 'utf8'),
  ].join('\n'),
);
mkdirSync(join(DIST, 'fonts'), { recursive: true });
for (const [, file] of appCss.matchAll(/url\('\.\/fonts\/([^']+)'\)/g)) {
  const pkg = file.startsWith('barlow-semi-condensed') ? '@fontsource/barlow-semi-condensed' : '@fontsource/barlow';
  cpSync(join(dirname(repoRequire.resolve(`${pkg}/package.json`)), 'files', file), join(DIST, 'fonts', file));
}

console.log(`built ${relative(REPO, DIST)}: ${Object.keys(icons).length} icons`);
