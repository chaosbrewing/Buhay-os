import type { EncryptedPlannerPayload } from '@workspace/api-client-react';
import { mergeReleaseTwoData, mergeReleaseTwoSnapshots } from '@workspace/planner-contract/release2-merge';
import type { ReleaseTwoPlannerData } from '@workspace/planner-contract/release2';

export const LEGACY_CACHE_KEY = 'daybook.encrypted-cache.v1';
export const accountCacheKey = (ownerId: string) => `daybook.account-cache.v2:${encodeURIComponent(ownerId)}`;
export const recoveryCacheKey = (ownerId: string) => `daybook.recovery.v1:${encodeURIComponent(ownerId)}`;
export const preImportKey = (ownerId: string) => `daybook.pre-import.v1:${encodeURIComponent(ownerId)}`;
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Local bookkeeping only. The server/encryption envelope is unchanged. */
export type AccountCache = {
  version: 2;
  ownerId: string;
  payload: EncryptedPlannerPayload;
  basePayload?: EncryptedPlannerPayload;
  baseRevision: number;
  dirty: boolean;
};
export function isEncryptedPayload(value: unknown): value is EncryptedPlannerPayload {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return item.cryptoVersion === 1 && item.kdf === 'PBKDF2-SHA256'
    && ['salt', 'iv', 'ciphertext'].every(key => typeof item[key] === 'string' && !!item[key]);
}
export function readAccountCache(storage: StorageLike, ownerId: string): AccountCache | null {
  const raw = storage.getItem(accountCacheKey(ownerId));
  if (!raw) return null;
  const value = JSON.parse(raw) as AccountCache;
  if (value.version !== 2 || value.ownerId !== ownerId || !isEncryptedPayload(value.payload)
    || !Number.isInteger(value.baseRevision) || value.baseRevision < 0 || typeof value.dirty !== 'boolean'
    || (value.basePayload !== undefined && !isEncryptedPayload(value.basePayload))) {
    throw new Error('The saved offline copy needs recovery. It has not been replaced.');
  }
  return value;
}
export function readLegacyCache(storage: StorageLike): EncryptedPlannerPayload | null {
  const raw = storage.getItem(LEGACY_CACHE_KEY);
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!isEncryptedPayload(value)) throw new Error('The older offline copy needs recovery. It has not been replaced.');
  return value;
}
export function writeAccountCache(storage: StorageLike, cache: AccountCache): void {
  storage.setItem(accountCacheKey(cache.ownerId), JSON.stringify(cache));
}
export function reconcilePlannerCopies(base: ReleaseTwoPlannerData | null, local: ReleaseTwoPlannerData,
  cloud: ReleaseTwoPlannerData, makeId: () => string): ReleaseTwoPlannerData {
  // Without a baseline, absence cannot safely mean deletion.
  return base ? mergeReleaseTwoSnapshots(base, local, cloud, makeId) : mergeReleaseTwoData(cloud, local, makeId).data;
}
export function preserveRecoveryCopies(storage: StorageLike, ownerId: string,
  local: EncryptedPlannerPayload, cloud?: EncryptedPlannerPayload): string {
  const key = `${recoveryCacheKey(ownerId)}:${crypto.randomUUID()}`;
  storage.setItem(key, JSON.stringify({ ownerId, local, cloud, createdAt: new Date().toISOString() }));
  return key;
}
