// What the automatic checks found on a Maintenance Request, in words: the flags a
// Property Manager should look at before confirming, the checks that passed, and a
// caption for each photo. The dashboard's decision rows, the Requests list and the
// review page all read them from here, so they always agree.

import type { ImageMatchResult } from '../ports.ts';
import type { PhotoMetadata } from '../tickets.ts';
import type { Tone } from './ui.ts';

/** A photo as the checks see it: its metadata result and why it was flagged. */
export interface CheckedPhoto {
  metadata: PhotoMetadata;
  reasons: string[];
}

/** A Maintenance Request as the checks see it. */
export interface CheckedRequest {
  checkUrgency: boolean;
  checkTrade: boolean;
  noPhotos: boolean;
  photos: CheckedPhoto[];
  imageMatch: { result: ImageMatchResult; reason: string } | null;
}

/** One check result: a short label, its tone, and the reason behind it when there is one. */
export interface Check {
  label: string;
  tone: Tone;
  detail?: string;
}

/** Why the metadata check flagged a photo, in words. */
export const PHOTO_FLAG: Record<string, string> = {
  taken_before_tenancy: 'taken before the tenancy',
  taken_long_before_report: 'taken over 14 days before the report',
  far_from_property: 'taken far from the Property',
};

/** Whether any photo's metadata was flagged. Missing metadata never counts against the Tenant. */
export function hasFlaggedPhotos(r: Pick<CheckedRequest, 'photos'>): boolean {
  return r.photos.some((p) => p.metadata === 'flagged');
}

/**
 * The flags to look at before confirming, most serious first: photos that don't
 * match the description, Check Urgency, Check Trade, flagged photos, no photos, and
 * an unclear photo check. Empty when nothing needs a second look.
 */
export function requestFlags(r: CheckedRequest): Check[] {
  const match = r.imageMatch;
  return [
    ...(match?.result === 'does_not_match' ? [{ label: "Photos don't match the description", tone: 'error' as const, detail: match.reason }] : []),
    ...(r.checkUrgency ? [{ label: 'Check Urgency', tone: 'warning' as const }] : []),
    ...(r.checkTrade ? [{ label: 'Check Trade', tone: 'warning' as const }] : []),
    ...(hasFlaggedPhotos(r) ? [{ label: 'Flagged photos', tone: 'warning' as const }] : []),
    ...(r.noPhotos ? [{ label: 'No photos', tone: 'warning' as const }] : []),
    ...(match?.result === 'unclear' ? [{ label: 'Photo check unclear', tone: 'warning' as const, detail: match.reason }] : []),
  ];
}

/** Whether a flag casts doubt on the report itself (the photos), so Confirm should ask first. */
export function doubtsPhotos(r: CheckedRequest): boolean {
  return r.imageMatch?.result === 'does_not_match' || hasFlaggedPhotos(r);
}

/** The checks that passed: the photos match the description, and every photo's metadata matches the report. */
export function passedChecks(r: CheckedRequest): Check[] {
  const match = r.imageMatch;
  const metadataOk = r.photos.length > 0 && r.photos.every((p) => p.metadata === 'ok');
  return [
    ...(match?.result === 'matches' ? [{ label: 'Photos match the description', tone: 'success' as const, detail: match.reason }] : []),
    ...(metadataOk ? [{ label: 'Photo metadata matches the report', tone: 'success' as const }] : []),
  ];
}

/** What the metadata check found on one photo, in words. */
export function photoCaption(p: CheckedPhoto): string {
  if (p.metadata === 'no_metadata') return 'No metadata';
  if (p.metadata === 'ok') return 'Metadata matches the report';
  return `Flagged: ${p.reasons.map((r) => PHOTO_FLAG[r] ?? r.replaceAll('_', ' ')).join(', ')}`;
}
