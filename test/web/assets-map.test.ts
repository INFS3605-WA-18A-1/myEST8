import { describe, expect, it } from 'vitest';
import { assetRoutes } from '../../src/web/assets.ts';

// The Dispatch map's files: Leaflet from node_modules, served offline like daisyUI, and the page's own script.

describe('assets for the Dispatch map', () => {
  const assets = assetRoutes();

  it('serves Leaflet and its stylesheet with their content types, cacheable', async () => {
    const js = await assets.request('/assets/leaflet.js');
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toMatch(/^text\/javascript/);
    expect(js.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(js.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await js.text()).toContain('Leaflet 1.9.4');

    const css = await assets.request('/assets/leaflet.css');
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toMatch(/^text\/css/);
    expect(await css.text()).toContain('.leaflet-container');
  });

  it("serves the page's own map script", async () => {
    const res = await assets.request('/assets/dispatch-map.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/javascript/);
  });

  it('serves the images Leaflet draws as PNG, under /assets/images/ where leaflet.css looks for them', async () => {
    for (const name of ['marker-icon.png', 'marker-icon-2x.png', 'marker-shadow.png', 'layers.png', 'layers-2x.png']) {
      const res = await assets.request(`/assets/images/${name}`);
      expect(res.status, name).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect([...bytes.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]); // "PNG"
    }
  });

  it('refuses every other file in Leaflet, the source maps included', async () => {
    for (const path of [
      '/assets/leaflet-src.js',
      '/assets/leaflet.js.map',
      '/assets/leaflet/leaflet.js',
      '/assets/images/unknown.png',
      '/assets/images/leaflet.js',
      '/assets/images/..%2Fleaflet.css',
      '/assets/images/..%2F..%2Fpackage.json',
      '/assets/images/',
      '/assets/images',
    ]) {
      expect((await assets.request(path)).status, path).toBe(404);
    }
  });
});
