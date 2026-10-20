// Reading an uploaded spreadsheet (.xlsx or .csv) into rows of text, and writing
// a CSV template. Only this file knows file formats; the import module works on
// plain rows.

import { readSheet } from 'read-excel-file/node';
import { ActionError } from './shared.ts';

/** Uploads bigger than this are refused before they are read. */
export const MAX_SHEET_BYTES = 2 * 1024 * 1024;

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

function refuse(message: string): never {
  throw new ActionError('invalid', message, { file: message });
}

/** One row of a sheet: its row number as the spreadsheet shows it, and its cells as text. */
export type SheetRow = { line: number; cells: string[] };

/**
 * The sheet's rows as trimmed text, empty rows dropped. Reads the first sheet of
 * an .xlsx file, or a .csv (comma, semicolon or tab separated, UTF-8 or the
 * Windows encoding Excel saves). Dates become YYYY-MM-DD. Refuses anything else.
 */
export async function readSpreadsheet(file: { filename: string; content: Uint8Array }): Promise<SheetRow[]> {
  const extension = /\.([a-z0-9]+)$/i.exec(file.filename)?.[1]?.toLowerCase() ?? '';
  if (file.content.byteLength > MAX_SHEET_BYTES) refuse(`That file is over ${MAX_SHEET_BYTES / 1024 / 1024} MB. Split the sheet, or save it as .csv.`);
  if (extension === 'xls') refuse(`${file.filename} is an old Excel file. Save it as .xlsx or .csv first (File, then Save as), then upload that.`);
  let rows: string[][];
  if (extension === 'xlsx') rows = await readXlsx(file.filename, file.content);
  else if (extension === 'csv' || extension === 'txt' || extension === 'tsv') rows = readCsv(decode(file.content));
  else refuse('Upload a spreadsheet saved as .xlsx or .csv');
  return rows
    .map((row, i) => ({ line: i + 1, cells: row.map((cell) => cell.trim()) }))
    .filter((row) => row.cells.some((cell) => cell !== ''));
}

async function readXlsx(filename: string, content: Uint8Array): Promise<string[][]> {
  const unreadable = `${filename} isn't a readable .xlsx file. Save it again from Excel, or as .csv.`;
  if (!ZIP_MAGIC.every((byte, i) => content[i] === byte)) refuse(unreadable);
  try {
    // A Buffer, never a string: readSheet reads a string as a file path.
    const data = await readSheet(Buffer.from(content.buffer, content.byteOffset, content.byteLength));
    return data.map((row) => row.map(cellText));
  } catch {
    refuse(unreadable);
  }
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

/** UTF-8, or Windows-1252 when the bytes aren't valid UTF-8 (Excel's "CSV" on Windows). */
function decode(content: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    return new TextDecoder('windows-1252').decode(content);
  }
}

/** RFC 4180 CSV: quoted fields may hold separators, quotes ("") and line breaks. */
function readCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, '');
  const firstLine = body.split(/\r?\n/, 1)[0] ?? '';
  const separator = [',', ';', '\t'].reduce((best, s) => (firstLine.split(s).length > firstLine.split(best).length ? s : best), ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === separator) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Rows as CSV text Excel opens cleanly: a byte-order mark for UTF-8, CRLF line ends, quotes only where needed. */
export function writeCsv(rows: string[][]): string {
  const quote = (cell: string) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
  return `﻿${rows.map((row) => row.map(quote).join(',')).join('\r\n')}\r\n`;
}
