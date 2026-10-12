import { one, run, type Db } from './db.ts';
import type { Clock } from './ports.ts';
import { iso } from './shared.ts';

export interface StoredFile {
  id: number;
  filename: string;
  contentType: string;
  content: Uint8Array;
}

/** File storage for photos, receipts, PDF quotes and message attachments. */
export function createFiles(db: Db, clock: Clock) {
  return {
    save(agencyId: number, file: { filename: string; contentType: string; content: Uint8Array }) {
      return run(
        db,
        'INSERT INTO files (agency_id, filename, content_type, content, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
        agencyId,
        file.filename,
        file.contentType,
        file.content,
        iso(clock.now()),
      );
    },

    /** A file belonging to the Agency, or null. */
    async getInAgency(agencyId: number, id: number): Promise<StoredFile | null> {
      const row = await one<{ agency_id: number }>(db, 'SELECT agency_id FROM files WHERE id = ?', id);
      return row?.agency_id === agencyId ? this.get(id) : null;
    },

    async get(id: number): Promise<StoredFile> {
      const row = await one<{ id: number; filename: string; content_type: string; content: Uint8Array }>(
        db,
        'SELECT id, filename, content_type, content FROM files WHERE id = ?',
        id,
      );
      if (!row) throw new Error(`File ${id} not found`);
      return { id: row.id, filename: row.filename, contentType: row.content_type, content: row.content };
    },
  };
}

export type Files = ReturnType<typeof createFiles>;
