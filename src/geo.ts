// Distances between points on the map, and the Dispatch map's one default for how
// far from a Property the Agency looks for Tradies.

export type Point = { lat: number; lng: number };

/**
 * How far from a Property the Dispatch map looks for Tradies, in km: the ring
 * drawn around a selected Property and the cut-off for its list of nearest
 * Tradies. The Agency will be able to change it in Settings; until that is
 * stored, this is the radius for everyone.
 */
export const TRADIE_SEARCH_RADIUS_KM = 15;

const EARTH_RADIUS_KM = 6371;

/** The great-circle distance between two points, in km (haversine). */
export function distanceKm(a: Point, b: Point): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** The items with a location within `radiusKm` of `from`, nearest first, each with its distance. */
export function nearest<T extends { location: Point | null }>(from: Point, items: T[], radiusKm: number, limit = Infinity): (T & { distanceKm: number })[] {
  return items
    .flatMap((item) => (item.location ? [{ ...item, distanceKm: distanceKm(from, item.location) }] : []))
    .filter((item) => item.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}
