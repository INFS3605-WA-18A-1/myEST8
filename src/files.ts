import { one, run, type Db } from './db.ts';
import { randomUUID } from 'node:crypto';
import type { BlobStore, Clock } from './ports.ts';
import { iso } from './shared.ts';

export interface StoredFile {
  id: number;
  filename: string;
  contentType: string;
  content: Uint8Array;
}

/**
 * File storage for photos, receipts, PDF quotes and message attachments. With a
 * `blobs` store (Supabase Storage) new files live there, the row holding only the
 * object path; files saved before that keep their bytes in the row.
 */
export function createFiles(db: Db, clock: Clock, blobs: BlobStore | null = null) {
  /** Where an upload waits until the app has checked it: one folder per Agency. */
  const stagingPrefix = (agencyId: number) => `staging/${agencyId}/`;

  return {
    async save(agencyId: number, file: { filename: string; contentType: string; content: Uint8Array }) {
      let storagePath: string | null = null;
      if (blobs) {
        storagePath = `${agencyId}/${randomUUID()}`;
        await blobs.put(storagePath, file.content, file.contentType);
      }
      return run(
        db,
        'INSERT INTO files (agency_id, filename, content_type, content, storage_path, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
        agencyId,
        file.filename,
        file.contentType,
        storagePath ? null : file.content,
        storagePath,
        iso(clock.now()),
      );
    },

    /** Whether browsers can upload straight to storage (see `stage`). */
    get direct() {
      return blobs !== null;
    },

    /** `count` URLs a browser can PUT a file to, for `take` to collect after. Null without a store. */
    async stage(agencyId: number, count: number): Promise<{ path: string; url: string }[] | null> {
      if (!blobs) return null;
      return Promise.all(
        Array.from({ length: count }, async () => {
          const path = `${stagingPrefix(agencyId)}${randomUUID()}`;
          return { path, url: await blobs.uploadUrl(path) };
        }),
      );
    },

    /** The bytes of a staged upload, which is then deleted. Refuses a path outside the Agency's staging folder. */
    async take(agencyId: number, path: string): Promise<Uint8Array> {
      if (!blobs || !path.startsWith(stagingPrefix(agencyId)) || path.includes('..')) throw new Error('Not an upload of this Agency');
      const content = await blobs.get(path);
      await blobs.remove(path);
      return content;
    },

    /** A file belonging to the Agency, or null. */
    async getInAgency(agencyId: number, id: number): Promise<StoredFile | null> {
      const row = await one<{ agency_id: number }>(db, 'SELECT agency_id FROM files WHERE id = ?', id);
      return row?.agency_id === agencyId ? this.get(id) : null;
    },

    async get(id: number): Promise<StoredFile> {
      const row = await one<{ id: number; filename: string; content_type: string; content: Uint8Array | null; storage_path: string | null }>(
        db,
        'SELECT id, filename, content_type, content, storage_path FROM files WHERE id = ?',
        id,
      );
      if (!row) throw new Error(`File ${id} not found`);
      const content = row.content ?? (row.storage_path && blobs ? await blobs.get(row.storage_path) : null);
      if (!content) throw new Error(`File ${id} is in storage, and none is configured`);
      return { id: row.id, filename: row.filename, contentType: row.content_type, content };
    },
  };
}

export type Files = ReturnType<typeof createFiles>;
