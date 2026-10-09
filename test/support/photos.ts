// Builds fixture photos: JPEG files with or without an EXIF block, so the real
// EXIF library can be run against them. The image data itself is empty because
// the image matcher is faked. The EXIF builder lives in src/demo/photo-exif.ts,
// which the demo also uses to stamp its sample photos.

import { fixtureJpeg, type PhotoMetadata } from '../../src/demo/photo-exif.ts';

export type { PhotoMetadata };

export function photo(metadata: PhotoMetadata = {}): Uint8Array {
  return fixtureJpeg(metadata);
}

export function upload(name: string, metadata?: PhotoMetadata) {
  return { filename: name, contentType: 'image/jpeg', content: photo(metadata) };
}
