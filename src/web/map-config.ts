// Where the Dispatch map gets its tiles, and the credit it must show for them. One
// value, used by the page and nothing else: to switch provider, change it here.
//
// The default is OpenStreetMap's public tile server. It is free and needs no key,
// but its usage policy (https://operations.osmfoundation.org/policies/tiles/) is not
// for heavy production use: an Agency's few Property Managers panning a map is fine,
// bulk downloads or an app with many users is not. Before going wider, point
// `url` at a tile provider you have an account with (MapTiler, Stadia, Mapbox, your
// own server) and use the attribution that provider asks for.

export interface MapTiles {
  /** A Leaflet tile URL template: {z}, {x}, {y} and optionally {s}. */
  url: string;
  /** The credit shown in the map's corner. A little HTML (links) is allowed: it is ours, not user input. */
  attribution: string;
  /** The deepest zoom the provider serves. */
  maxZoom: number;
}

export const MAP_TILES: MapTiles = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
};
