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
  db.exec(`CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY,
    agency_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    content BLOB NOT NULL,
    created_at TEXT NOT NULL
  )`);

  return {
    save(agencyId: number, file: { filename: string; contentType: string; content: Uint8Array }) {
      return run(
        db,
        'INSERT INTO files (agency_id, filename, content_type, content, created_at) VALUES (?, ?, ?, ?, ?)',
        agencyId,
        file.filename,
        file.contentType,
        file.content,
        iso(clock.now()),
      );
    },

    get(id: number): StoredFile {
      const row = one<{ id: number; filename: string; content_type: string; content: Uint8Array }>(
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
