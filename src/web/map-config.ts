// Where the Dispatch map gets its tiles, and the credit it must show for them. Used by
// the page and nothing else: to switch provider, change it here.
//
// A light grey basemap, so the pins carry the colour and the map stays calm. The choice
// is CARTO's Positron. Since 25 September 2026 CARTO serves its tiles only with an API
// key (keyless, every tile reads "API KEY REQUIRED"); a key is free and needs no account
// (https://carto.com/basemaps/apikey, 1M requests a month for commercial use). Set it as
// CARTO_BASEMAPS_KEY. Until then the map uses Esri's World Light Gray Base, which needs
// no key, rather than show CARTO's notice. Never OpenStreetMap's own tile server: its
// usage policy (https://operations.osmfoundation.org/policies/tiles/) is not for production apps.

export interface MapTiles {
  /** A Leaflet tile URL template: {z}, {x}, {y}, and optionally {s} (a subdomain) and {r} ("@2x" on retina screens). */
  url: string;
  /** The subdomains {s} takes, one letter each, when the URL has {s}. */
  subdomains?: string;
  /** The credit shown in the map's corner. A little HTML (links) is allowed: it is ours, not user input. */
  attribution: string;
  /** The deepest zoom the provider serves. */
  maxZoom: number;
}

/** CARTO Positron, without its key. */
const CARTO_POSITRON: MapTiles = {
  url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  subdomains: 'abcd',
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  maxZoom: 20,
};

/** Esri's World Light Gray Base: keyless, grey, real tiles to zoom 16 ("Map data not yet available" past it). */
const ESRI_LIGHT_GRAY: MapTiles = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
  maxZoom: 16,
};

/** The tiles the page uses: CARTO Positron with the Agency's CARTO key (CARTO_BASEMAPS_KEY), or Esri's grey base without one. */
export function mapTiles(env: Record<string, string | undefined> = process.env): MapTiles {
  const key = env.CARTO_BASEMAPS_KEY?.trim();
  return key ? { ...CARTO_POSITRON, url: `${CARTO_POSITRON.url}?key=${encodeURIComponent(key)}` } : ESRI_LIGHT_GRAY;
}
