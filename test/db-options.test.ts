// How openDb chooses connection options from the URL: TLS for any database that
// isn't on this machine, and the transaction pooler's limits. Pure; no database.

import { describe, expect, test } from 'vitest';
import { connectionOptions } from '../src/db.ts';

const POOLER = 'postgres://postgres.abc:pw@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres';
const SESSION_POOLER = 'postgres://postgres.abc:pw@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres';

describe('TLS', () => {
  test.each([
    ['localhost', 'postgres://u:p@localhost:5432/db'],
    ['127.0.0.1', 'postgres://postgres:postgres@127.0.0.1:54340/myest8'],
    ['::1', 'postgres://u:p@[::1]:5432/db'],
  ])('a local database (%s) gets no ssl option, so the URL decides as before', (_name, url) => {
    const options = connectionOptions(url, 'public');
    expect('ssl' in options).toBe(false);
    expect('fetch_types' in options).toBe(false);
  });

  test('a Supabase pooler URL without sslmode requires TLS', () => {
    expect(connectionOptions(POOLER, 'public').ssl).toBe('require');
    expect(connectionOptions(SESSION_POOLER, 'public').ssl).toBe('require');
  });

  test('any other non-local host requires TLS', () => {
    expect(connectionOptions('postgres://u:p@db.example.com/db', 'public').ssl).toBe('require');
    expect(connectionOptions('not a url', 'public').ssl).toBe('require');
  });

  test.each(['require', 'verify-ca', 'verify-full', 'no-verify'])('a URL with sslmode=%s is left to the URL', (mode) => {
    const options = connectionOptions(`${POOLER}?sslmode=${mode}`, 'public');
    expect('ssl' in options).toBe(false);
  });

  test.each(['disable', 'allow', 'prefer'])('a non-local URL with sslmode=%s (a mode that can go without TLS) still requires it', (mode) => {
    expect(connectionOptions(`${SESSION_POOLER}?sslmode=${mode}`, 'public').ssl).toBe('require');
  });

  test('a local URL with sslmode=disable is left alone', () => {
    expect('ssl' in connectionOptions('postgres://u:p@localhost/db?sslmode=disable', 'public')).toBe(false);
  });
});

describe('hosted databases', () => {
  test('skip the type lookup at connect (the app uses no array types), local ones keep it', () => {
    expect(connectionOptions(POOLER, 'public').fetch_types).toBe(false);
    expect('fetch_types' in connectionOptions('postgres://u:p@127.0.0.1/db', 'public')).toBe(false);
  });
});

describe('the transaction pooler (port 6543)', () => {
  test('turns off prepared statements, as a session connection does not', () => {
    expect(connectionOptions(POOLER, 'public').prepare).toBe(false);
    expect(connectionOptions(`${POOLER}?sslmode=require`, 'public').prepare).toBe(false);
    expect(connectionOptions(SESSION_POOLER, 'public').prepare).toBe(true);
    expect(connectionOptions('postgres://u:p@localhost:5432/db', 'public').prepare).toBe(true);
  });

  test('keeps the public schema without a search_path startup parameter', () => {
    expect(connectionOptions(POOLER, 'public').connection).toEqual({});
  });

  test('refuses another schema, which would silently be ignored there', () => {
    expect(() => connectionOptions(POOLER, 'myest8')).toThrow(/DATABASE_SCHEMA.*myest8.*6543/s);
    expect(() => connectionOptions(`${POOLER}?sslmode=require`, 'myest8')).toThrow(/6543/);
  });

  test('another schema is fine on a session connection and sets search_path', () => {
    expect(connectionOptions(SESSION_POOLER, 'myest8').connection).toEqual({ search_path: '"myest8"' });
    expect(connectionOptions('postgres://u:p@localhost:5432/db', 'kept').connection).toEqual({ search_path: '"kept"' });
  });

  test('the refusal never prints the URL (it holds the password)', () => {
    const refuse = () => connectionOptions(POOLER, 'myest8');
    expect(refuse).toThrow(/transaction pooler/);
    expect(refuse).not.toThrow(/pw@|postgres:\/\//);
  });
});
