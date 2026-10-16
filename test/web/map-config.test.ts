import { describe, expect, test } from 'vitest';
import { mapTiles } from '../../src/web/map-config.ts';

// The Dispatch map's tiles: a light grey basemap, so the pins carry the colour. CARTO
// Positron with the Agency's CARTO key; without a key (CARTO serves nothing keyless),
// Esri's World Light Gray Base. Never OSM's own tile server, whose usage policy is not
// for production use.

describe('the Dispatch map tiles', () => {
  test('with CARTO_BASEMAPS_KEY set, are CARTO Positron from its four subdomains, sharp on retina screens, carrying the key', () => {
    const tiles = mapTiles({ CARTO_BASEMAPS_KEY: 'k3y/with+odd=chars' });

    expect(tiles.url).toBe('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=k3y%2Fwith%2Bodd%3Dchars');
    expect(tiles.subdomains).toBe('abcd');
    expect(tiles.maxZoom).toBe(20);
  });

  test('with a key, credit OpenStreetMap contributors and CARTO, each linked', () => {
    expect(mapTiles({ CARTO_BASEMAPS_KEY: 'abc' }).attribution).toBe(
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    );
  });

  test("without a key (or a blank one), are Esri's World Light Gray Base to zoom 16, credited to Esri", () => {
    for (const env of [{}, { CARTO_BASEMAPS_KEY: '  ' }]) {
      expect(mapTiles(env)).toEqual({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
        maxZoom: 16,
      });
    }
  });

  test('never come from tile.openstreetmap.org', () => {
    for (const env of [{}, { CARTO_BASEMAPS_KEY: 'abc' }]) expect(mapTiles(env).url).not.toContain('tile.openstreetmap.org');
  });
});
