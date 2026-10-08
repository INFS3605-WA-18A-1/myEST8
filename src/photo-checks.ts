import exifr from 'exifr';
import type { PhotoMetadata } from './tickets.ts';
import { zonedInstant } from './zoned-time.ts';

export type PhotoFlag = 'taken_before_tenancy' | 'taken_long_before_report' | 'far_from_property';

const DAY_MS = 86_400_000;

/**
 * Checks a photo's metadata against the report. A photo is flagged only when its
 * metadata contradicts the report; missing metadata never counts against it.
 */
export async function checkPhotoMetadata(
  content: Uint8Array,
  report: {
    reportedAt: Date;
    tenancyStart: string | null;
    propertyLocation: { lat: number; lng: number } | null;
    timeZone: string;
    maxAgeDays: number;
    maxDistanceKm: number;
  },
): Promise<{ metadata: PhotoMetadata; reasons: PhotoFlag[] }> {
  const exif = await readExif(content);
  if (!exif.takenAt && !exif.gps) return { metadata: 'no_metadata', reasons: [] };

  const reasons: PhotoFlag[] = [];
  const takenAt = exif.takenAt && wallClockToInstant(exif.takenAt, report.timeZone);
  if (takenAt && report.tenancyStart) {
    const [year, month, day] = report.tenancyStart.split('-').map(Number) as [number, number, number];
    if (takenAt < zonedInstant(report.timeZone, year, month, day)) reasons.push('taken_before_tenancy');
  }
  if (takenAt && report.reportedAt.getTime() - takenAt.getTime() > report.maxAgeDays * DAY_MS) {
    reasons.push('taken_long_before_report');
  }
  if (exif.gps && report.propertyLocation && distanceKm(exif.gps, report.propertyLocation) > report.maxDistanceKm) {
    reasons.push('far_from_property');
  }
  return { metadata: reasons.length ? 'flagged' : 'ok', reasons };
}

async function readExif(content: Uint8Array) {
  try {
    const tags = (await exifr.parse(content, { reviveValues: false })) as Record<string, unknown> | undefined;
    const gps = await exifr.gps(content);
    const takenAt = tags?.DateTimeOriginal ?? tags?.CreateDate;
    return {
      takenAt: typeof takenAt === 'string' ? takenAt : null,
      gps: gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude) ? { lat: gps.latitude, lng: gps.longitude } : null,
    };
  } catch {
    // Not an image exifr understands, or no EXIF block at all.
    return { takenAt: null, gps: null };
  }
}

/** EXIF times have no zone; read them as the Agency's local time. "2026:10:07 18:30:00" */
function wallClockToInstant(value: string, timeZone: string) {
  const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number) as number[];
  return zonedInstant(timeZone, y!, mo!, d!, h!, mi!, s!);
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
