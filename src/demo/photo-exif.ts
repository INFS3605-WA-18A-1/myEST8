// EXIF for demo and test photos: a phone writes when a photo was taken and,
// with location on, where. The photo checks read exactly these two tags, so
// the demo can show clean and flagged photos, and tests can run the real EXIF
// library against fixtures.

/** What a phone records about a photo. */
export interface PhotoMetadata {
  /** EXIF wall-clock time, as a phone writes it: "2026:10:07 18:30:00". */
  takenAt?: string;
  gps?: { lat: number; lng: number };
}

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];

/**
 * A copy of a JPEG with an EXIF block holding `metadata`, placed straight after
 * the start-of-image marker where phones put it. With no metadata the JPEG is
 * returned unchanged.
 */
export function withExif(jpeg: Uint8Array, metadata: PhotoMetadata): Uint8Array {
  if (jpeg[0] !== SOI[0] || jpeg[1] !== SOI[1]) throw new Error('Not a JPEG: it must start with the FFD8 marker');
  if (!metadata.takenAt && !metadata.gps) return jpeg;
  const app1 = exifSegment(metadata);
  const out = new Uint8Array(jpeg.length + app1.length);
  out.set(SOI, 0);
  out.set(app1, 2);
  out.set(jpeg.subarray(2), 2 + app1.length);
  return out;
}

/** A JPEG with an EXIF block (or none) and no image data: enough for the metadata checks, not to display. */
export function fixtureJpeg(metadata: PhotoMetadata = {}): Uint8Array {
  if (!metadata.takenAt && !metadata.gps) return new Uint8Array([...SOI, ...EOI]);
  return new Uint8Array([...SOI, ...exifSegment(metadata), ...EOI]);
}

/** An EXIF time for `at` on the wall clock of `timeZone`: "2026:10:07 18:30:00". */
export function exifTime(at: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}:${parts.month}:${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

const ASCII = 2;
const LONG = 4;
const RATIONAL = 5;

/** The APP1 segment: marker, length, "Exif\0\0" and a big-endian TIFF block. */
function exifSegment(metadata: PhotoMetadata): number[] {
  const body = [...ascii('Exif\0\0'), ...tiff(metadata)];
  const length = body.length + 2;
  return [0xff, 0xe1, length >> 8, length & 0xff, ...body];
}

function tiff({ takenAt, gps }: PhotoMetadata): number[] {
  const view = new DataView(new ArrayBuffer(512));
  const ifd0 = 8;
  const ifd0Count = (takenAt ? 1 : 0) + (gps ? 1 : 0);
  let cursor = ifd0 + 2 + ifd0Count * 12 + 4;
  const exifIfd = cursor;
  if (takenAt) cursor += 2 + 12 + 4;
  const gpsIfd = cursor;
  if (gps) cursor += 2 + 4 * 12 + 4;
  const dateAt = cursor;
  if (takenAt) cursor += 20;
  const latAt = cursor;
  const lngAt = cursor + 24;
  if (gps) cursor += 48;

  view.setUint16(0, 0x4d4d); // "MM": big-endian
  view.setUint16(2, 42);
  view.setUint32(4, ifd0);

  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    view.setUint16(at, tag);
    view.setUint16(at + 2, type);
    view.setUint32(at + 4, count);
    view.setUint32(at + 8, value);
  };

  view.setUint16(ifd0, ifd0Count);
  let next = ifd0 + 2;
  if (takenAt) {
    entry(next, 0x8769, LONG, 1, exifIfd);
    next += 12;
  }
  if (gps) entry(next, 0x8825, LONG, 1, gpsIfd);

  if (takenAt) {
    view.setUint16(exifIfd, 1);
    entry(exifIfd + 2, 0x9003, ASCII, 20, dateAt); // DateTimeOriginal
    ascii(`${takenAt}\0`).forEach((b, i) => view.setUint8(dateAt + i, b));
  }

  if (gps) {
    view.setUint16(gpsIfd, 4);
    entry(gpsIfd + 2, 0x0001, ASCII, 2, (gps.lat < 0 ? 0x53 : 0x4e) << 24); // "S" or "N"
    entry(gpsIfd + 14, 0x0002, RATIONAL, 3, latAt);
    entry(gpsIfd + 26, 0x0003, ASCII, 2, (gps.lng < 0 ? 0x57 : 0x45) << 24); // "W" or "E"
    entry(gpsIfd + 38, 0x0004, RATIONAL, 3, lngAt);
    writeDegrees(view, latAt, Math.abs(gps.lat));
    writeDegrees(view, lngAt, Math.abs(gps.lng));
  }

  return [...new Uint8Array(view.buffer, 0, cursor)];
}

function writeDegrees(view: DataView, at: number, value: number) {
  const degrees = Math.floor(value);
  const minutes = Math.floor((value - degrees) * 60);
  const seconds = Math.round(((value - degrees) * 60 - minutes) * 60 * 10000);
  [
    [degrees, 1],
    [minutes, 1],
    [seconds, 10000],
  ].forEach(([numerator, denominator], i) => {
    view.setUint32(at + i * 8, numerator!);
    view.setUint32(at + i * 8 + 4, denominator!);
  });
}

function ascii(text: string) {
  return [...text].map((c) => c.charCodeAt(0));
}
