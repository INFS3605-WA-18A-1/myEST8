// A Property's photo. Adding a Property schedules a fetch so the request never
// waits on Google; the task uses the map point when the Property has one, and
// the address otherwise. A Property Manager's own photo is never replaced by a
// later fetch. "Use the online photo" asks again and stores whatever comes back.

import type { Context } from './context.ts';
import { one, run } from './db.ts';
import type { PropertyPhoto } from './ports.ts';
import { invalid } from './shared.ts';

/** What a Property Manager may upload in place of the online photo. HEIC's container is heif. */
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

type PhotoRow = {
  id: number;
  agency_id: number;
  address: string;
  lat: number | null;
  lng: number | null;
  photo_file_id: number | null;
  photo_source: 'fetched' | 'manager' | null;
};

function permanent(message: string): Error {
  const error = new Error(message) as Error & { permanent: boolean };
  error.permanent = true;
  return error;
}

function extension(contentType: string) {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/heic' || contentType === 'image/heif') return 'heic';
  return 'jpg';
}

async function photoRow(ctx: Context, propertyId: number): Promise<PhotoRow | undefined> {
  return one<PhotoRow>(
    ctx.db,
    'SELECT id, agency_id, address, lat, lng, photo_file_id, photo_source FROM properties WHERE id = ?',
    propertyId,
  );
}

/** The place the lookup should see: the map point when both coordinates are stored. */
function placeOf(row: PhotoRow) {
  return {
    address: row.address,
    location: row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : null,
  };
}

/**
 * Fetches a photo and stores it when the Property has none. A Property Manager's
 * photo, or one already fetched, is left as it is. No imagery stores nothing.
 * A failed lookup throws so the task retries. A missing Property does not.
 */
export async function fetchPropertyPhoto(ctx: Context, propertyId: number) {
  const row = await photoRow(ctx, propertyId);
  if (!row) throw permanent(`Property ${propertyId} not found`);
  if (row.photo_source === 'manager' || row.photo_file_id !== null) return;
  const photo = await ctx.ports.propertyPhotos.lookup(placeOf(row));
  if (!photo) return;
  await storeFetched(ctx, row, photo);
}

/** Saves a fetched photo only while the Property still has none, so a photo uploaded meanwhile stays. */
async function storeFetched(ctx: Context, row: PhotoRow, photo: PropertyPhoto) {
  const fileId = await ctx.files.save(row.agency_id, {
    filename: `property-photo.${extension(photo.contentType)}`,
    contentType: photo.contentType,
    content: photo.content,
  });
  const saved = await one(
    ctx.db,
    `UPDATE properties SET photo_file_id = ?, photo_source = 'fetched'
     WHERE id = ? AND photo_file_id IS NULL AND photo_source IS NULL
     RETURNING id`,
    fileId,
    row.id,
  );
  if (!saved) await ctx.files.remove(fileId);
}

/**
 * Stores the Property Manager's photo in place of whatever is there. The previous
 * file is removed once the Property points at the new one. Refuses a file that
 * isn't a photo or is over 10 MB, and a Property outside the Agency.
 */
export async function replacePropertyPhoto(
  ctx: Context,
  agencyId: number,
  propertyId: number,
  upload: { filename: string; contentType: string; content: Uint8Array },
) {
  const property = await ctx.modules.profiles.propertyInAgency(agencyId, propertyId);
  if (!PHOTO_TYPES.includes(upload.contentType)) invalid('Upload a JPEG, PNG, WebP or HEIC photo.');
  if (upload.content.byteLength === 0) invalid('Choose a photo to upload.');
  if (upload.content.byteLength > MAX_PHOTO_BYTES) invalid('The photo must be under 10 MB.');
  const fileId = await ctx.files.save(agencyId, upload);
  await run(ctx.db, `UPDATE properties SET photo_file_id = ?, photo_source = 'manager' WHERE id = ? AND agency_id = ?`, fileId, propertyId, agencyId);
  if (property.photoFileId !== null && property.photoFileId !== fileId) await ctx.files.remove(property.photoFileId);
}

/**
 * Fetches the online photo again and stores it in place of the Property Manager's.
 * Refuses when there is no imagery, or when the lookup fails. A Property outside
 * the Agency is refused the same way as any other Property action.
 */
export async function useOnlinePropertyPhoto(ctx: Context, agencyId: number, propertyId: number) {
  const property = await ctx.modules.profiles.propertyInAgency(agencyId, propertyId);
  let photo: PropertyPhoto | null;
  try {
    photo = await ctx.ports.propertyPhotos.lookup({ address: property.address, location: property.location });
  } catch {
    invalid("The online photo couldn't be fetched. Try again.");
  }
  if (!photo) invalid("There's no online photo of this Property.");
  const fileId = await ctx.files.save(agencyId, {
    filename: `property-photo.${extension(photo.contentType)}`,
    contentType: photo.contentType,
    content: photo.content,
  });
  await run(ctx.db, `UPDATE properties SET photo_file_id = ?, photo_source = 'fetched' WHERE id = ? AND agency_id = ?`, fileId, propertyId, agencyId);
  if (property.photoFileId !== null && property.photoFileId !== fileId) await ctx.files.remove(property.photoFileId);
}

/** Runs the fetch in the background, one task per Property. */
export function registerPropertyPhotos(ctx: Context) {
  ctx.worker.on<{ propertyId: number }>('properties.fetch_photo', ({ propertyId }) => fetchPropertyPhoto(ctx, propertyId));
}
