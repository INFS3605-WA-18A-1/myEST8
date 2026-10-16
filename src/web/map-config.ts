// Where the Dispatch map gets its tiles, and the credit it must show for them. One
// value, used by the page and nothing else: to switch provider, change it here.
//
// CARTO's Positron basemap: light grey streets and pale water, so the pins carry the
// colour and the map stays calm. It is free with attribution and needs no key, within
// CARTO's fair use (https://carto.com/basemaps); an Agency going wider should take a
// CARTO plan or point `url` at a provider it has an account with. Never OpenStreetMap's
// own tile server: its usage policy (https://operations.osmfoundation.org/policies/tiles/)
// is not for production apps.

export interface MapTiles {
  /** A Leaflet tile URL template: {z}, {x}, {y}, {s} (a subdomain) and {r} ("@2x" on retina screens). */
  url: string;
  /** The subdomains {s} takes, one letter each. */
  subdomains: string;
  /** The credit shown in the map's corner. A little HTML (links) is allowed: it is ours, not user input. */
  attribution: string;
  /** The deepest zoom the provider serves. */
  maxZoom: number;
}

export const MAP_TILES: MapTiles = {
  url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  subdomains: 'abcd',
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  maxZoom: 20,
};
