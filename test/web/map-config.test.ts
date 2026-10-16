import { describe, expect, test } from 'vitest';
import { MAP_TILES } from '../../src/web/map-config.ts';

// The Dispatch map's tiles: CARTO's light, grey Positron basemap, so the pins carry the
// colour, credited to both OpenStreetMap and CARTO. Never OSM's own tile server, whose
// usage policy is not for production use.

describe('the Dispatch map tiles', () => {
  test('are CARTO Positron from its four subdomains, sharp on retina screens', () => {
    expect(MAP_TILES.url).toBe('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png');
    expect(MAP_TILES.subdomains).toBe('abcd');
  });

  test('credit OpenStreetMap contributors and CARTO, each linked', () => {
    expect(MAP_TILES.attribution).toBe(
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    );
  });

  test('never come from tile.openstreetmap.org', () => {
    expect(JSON.stringify(MAP_TILES)).not.toContain('tile.openstreetmap.org');
  });
});
