import { describe, expect, it } from 'vitest';
import { assetRoutes } from '../../src/web/assets.ts';

// The Dispatch map's files: MapLibre GL JS from node_modules, served offline like daisyUI, and the page's own script.

describe('assets for the Dispatch map', () => {
  const assets = assetRoutes();

  it('serves MapLibre GL JS as a JavaScript module, cacheable', async () => {
    const js = await assets.request('/assets/maplibre-gl.mjs');
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toMatch(/^text\/javascript/);
    expect(js.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(js.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await js.text()).toContain('MapLibre GL JS');
  });

  it("serves MapLibre's worker, which it loads from beside the module", async () => {
    const worker = await assets.request('/assets/maplibre-gl-worker.mjs');
    expect(worker.status).toBe(200);
    expect(worker.headers.get('content-type')).toMatch(/^text\/javascript/);
    expect(worker.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(await worker.text()).toContain('MapLibre GL JS');
  });

  it('serves its stylesheet', async () => {
    const css = await assets.request('/assets/maplibre-gl.css');
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toMatch(/^text\/css/);
    expect(css.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(await css.text()).toContain('.maplibregl-map');
  });

  it("serves the page's own map script", async () => {
    const res = await assets.request('/assets/dispatch-map.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/javascript/);
  });

  it('no longer serves Leaflet, its grouping or its images', async () => {
    for (const path of ['/assets/leaflet.js', '/assets/leaflet.css', '/assets/leaflet.markercluster.js', '/assets/MarkerCluster.css', '/assets/images/marker-icon.png', '/assets/images/layers.png']) {
      expect((await assets.request(path)).status, path).toBe(404);
    }
  });

  it('refuses every other file in MapLibre, the source maps and development builds included', async () => {
    for (const path of [
      '/assets/maplibre-gl.mjs.map',
      '/assets/maplibre-gl-worker.mjs.map',
      '/assets/maplibre-gl-dev.mjs',
      '/assets/maplibre-gl-worker-dev.mjs',
      '/assets/maplibre-gl-shared.mjs',
      '/assets/maplibre-gl.d.ts',
      '/assets/maplibre-gl/maplibre-gl.mjs',
      '/assets/..%2Fpackage.json',
    ]) {
      expect((await assets.request(path)).status, path).toBe(404);
    }
  });
});
