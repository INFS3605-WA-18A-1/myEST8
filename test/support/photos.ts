// Builds fixture photos: JPEG files with or without an EXIF block, so the real
// EXIF library can be run against them. The image data itself is empty because
// the image matcher is faked.

export interface PhotoMetadata {
  /** EXIF wall-clock time, as a phone writes it: "2026:10:07 18:30:00". */
  takenAt?: string;
  gps?: { lat: number; lng: number };
}

export function photo(metadata: PhotoMetadata = {}): Uint8Array {
  const soi = [0xff, 0xd8];
  const eoi = [0xff, 0xd9];
  if (!metadata.takenAt && !metadata.gps) return new Uint8Array([...soi, ...eoi]);
  const body = [...ascii('Exif\0\0'), ...tiff(metadata)];
  const length = body.length + 2;
  return new Uint8Array([...soi, 0xff, 0xe1, length >> 8, length & 0xff, ...body, ...eoi]);
}

export function upload(name: string, metadata?: PhotoMetadata) {
  return { filename: name, contentType: 'image/jpeg', content: photo(metadata) };
}

const ASCII = 2;
const LONG = 4;
const RATIONAL = 5;

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
