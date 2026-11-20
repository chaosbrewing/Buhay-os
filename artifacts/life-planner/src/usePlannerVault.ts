import { useCallback, useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetPlannerStateQueryKey, getListPlannerVersionsQueryKey, useGetPlannerState, useSavePlannerState } from '@workspace/api-client-react';
import type { EncryptedPlannerPayload } from '@workspace/api-client-react';
import type { ReleaseTwoPlannerData as Data } from './lib/planner-model';
import { decryptSnapshot, deriveKey, encryptSnapshot, randomBase64 } from './planner-crypto';
import { LEGACY_CACHE_KEY, accountCacheKey, preImportKey, preserveRecoveryCopies, readAccountCache,
  readLegacyCache, reconcilePlannerCopies, writeAccountCache } from './planner-cache';

type Recovery = { local: Data; merged: Data; missingBase: boolean; legacy: boolean };
function hasStoredCache(ownerId: string) {
  try { return !!localStorage.getItem(accountCacheKey(ownerId)) || !!localStorage.getItem(LEGACY_CACHE_KEY); }
  catch { return false; }
}

/** Owns only web session/cache lifecycle; the API and crypto contracts are unchanged. */
export function usePlannerVault(data: Data, setData: Dispatch<SetStateAction<Data>>, onLock: () => void) {
  const { userId } = useAuth();
  const ownerId = userId ?? '';
  const client = useQueryClient();
  const plannerState = useGetPlannerState({ query: { queryKey: getGetPlannerStateQueryKey(), refetchInterval: 5000 } });
  const saveMutation = useSavePlannerState();
  const mutateRef = useRef(saveMutation.mutate); mutateRef.current = saveMutation.mutate;
  const [passphrase, setPassphrase] = useState('');
  const [passphraseAgain, setPassphraseAgain] = useState('');
  const [passphraseError, setPassphraseError] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [syncStatus, setSyncStatus] = useState<'ready' | 'syncing' | 'offline' | 'queued' | 'error'>('ready');
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const cryptoKeyRef = useRef<CryptoKey | null>(null);
  const saltRef = useRef('');
  const revisionRef = useRef(0);
  const basePayloadRef = useRef<EncryptedPlannerPayload | undefined>(undefined);
  const readyRef = useRef(false);
  const lastSavedJsonRef = useRef('');
  const lastAttemptedJsonRef = useRef('');
  const dataRef = useRef(data); dataRef.current = data;
  const onLockRef = useRef(onLock); onLockRef.current = onLock;
  const epoch = useRef(0);
  const cacheSequence = useRef(0);
  const recoveryGeneration = useRef(0);
  const invalidate = useCallback(() => { epoch.current++; readyRef.current = false; cryptoKeyRef.current = null; }, []);
  useEffect(() => () => invalidate(), [invalidate]);
  useEffect(() => {
    const changed = () => { invalidate(); setUnlocked(false); setRecovery(null); setPassphrase(''); setPassphraseAgain(''); onLockRef.current(); };
    window.addEventListener('daybook:account-change', changed);
    return () => window.removeEventListener('daybook:account-change', changed);
  }, [invalidate]);
  useEffect(() => {
    const connected = () => { lastAttemptedJsonRef.current = ''; setOnline(true); void plannerState.refetch(); };
    const disconnected = () => { setOnline(false); setSyncStatus('offline'); };
    window.addEventListener('online', connected); window.addEventListener('offline', disconnected);
    return () => { window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected); };
  }, [plannerState.refetch]);

  const persistLocal = useCallback(async (snapshot: Data) => {
    const key = cryptoKeyRef.current;
    if (!key || !ownerId) throw new Error('Unlock this account before saving.');
    const sequence = ++cacheSequence.current;
    const serialized = JSON.stringify(snapshot);
    const payload = await encryptSnapshot(snapshot, key, saltRef.current);
    // A slower old encryption must never overwrite a newer local edit.
    // An unmounted session may finish caching into its own account, never another account.
    if (sequence === cacheSequence.current) {
      writeAccountCache(localStorage, { version: 2, ownerId, payload, basePayload: basePayloadRef.current,
        baseRevision: revisionRef.current, dirty: serialized !== lastSavedJsonRef.current });
    }
    return payload;
  }, [ownerId]);

  // Cache immediately, independently of network debounce/pending requests.
  useEffect(() => {
    if (!unlocked || !readyRef.current) return;
    void persistLocal(data).catch(() => setSyncStatus('error'));
  }, [data, unlocked, persistLocal]);

  const saveEncrypted = useCallback(async (snapshot: Data) => {
    if (!readyRef.current || !cryptoKeyRef.current) return;
    const generation = epoch.current;
    const serialized = JSON.stringify(snapshot);
    try {
      const payload = await persistLocal(snapshot);
      if (generation !== epoch.current || !readyRef.current) return;
      if (!navigator.onLine) { setSyncStatus('offline'); return; }
      lastAttemptedJsonRef.current = serialized;
      setSyncStatus('syncing');
      mutateRef.current({ data: { expectedRevision: revisionRef.current, payload } }, {
        onSuccess: result => {
          if (generation !== epoch.current || !readyRef.current || result.revision < revisionRef.current) return;
          revisionRef.current = result.revision; basePayloadRef.current = result.payload;
          lastSavedJsonRef.current = serialized;
          // Do not replace newer edits with an older save's response.
          void persistLocal(dataRef.current).catch(() => setSyncStatus('error'));
          setSyncStatus(JSON.stringify(dataRef.current) === serialized ? 'ready' : 'queued');
          void client.invalidateQueries({ queryKey: getGetPlannerStateQueryKey() });
          void client.invalidateQueries({ queryKey: getListPlannerVersionsQueryKey() });
        },
        onError: () => {
          if (generation !== epoch.current) return;
          setSyncStatus('error');
          void client.invalidateQueries({ queryKey: getGetPlannerStateQueryKey() });
        },
      });
    } catch { if (generation === epoch.current) setSyncStatus('error'); }
  }, [client, persistLocal]);
  useEffect(() => {
    if (!unlocked || !readyRef.current || saveMutation.isPending || !online) return;
    const json = JSON.stringify(data);
    if (json === lastSavedJsonRef.current || json === lastAttemptedJsonRef.current) return;
    setSyncStatus('queued');
    const timer = setTimeout(() => void saveEncrypted(data), 850);
    return () => clearTimeout(timer);
  }, [data, unlocked, online, saveMutation.isPending, saveEncrypted]);

  const openRecovery = useCallback(async (local: Data, cloud: Data, base: Data | null,
    localPayload: EncryptedPlannerPayload, cloudPayload: EncryptedPlannerPayload, legacy = false) => {
    preserveRecoveryCopies(localStorage, ownerId, localPayload, cloudPayload);
    const merged = reconcilePlannerCopies(base, local, cloud, () => crypto.randomUUID());
    readyRef.current = false;
    // Cancel in-flight callbacks and scheduling while the user decides.
    epoch.current++;
    recoveryGeneration.current = epoch.current;
    setUnlocked(false);
    setRecovery({ local, merged, missingBase: !base, legacy });
  }, [ownerId]);

  useEffect(() => {
    const remote = plannerState.data;
    const key = cryptoKeyRef.current;
    if (!unlocked || !readyRef.current || !key || !remote?.payload || remote.revision <= revisionRef.current) return;
    let cancelled = false;
    const generation = epoch.current;
    void (async () => {
      try {
        const cloud = await decryptSnapshot(remote.payload!, key);
        if (cancelled || generation !== epoch.current) return;
        const local = dataRef.current;
        const baseline = lastSavedJsonRef.current ? JSON.parse(lastSavedJsonRef.current) as Data : null;
        if (JSON.stringify(local) !== lastSavedJsonRef.current) {
          const localPayload = await persistLocal(local);
          if (cancelled || generation !== epoch.current) return;
          await openRecovery(local, cloud, baseline, localPayload, remote.payload!);
        } else {
          lastSavedJsonRef.current = JSON.stringify(cloud); setData(cloud); setSyncStatus('ready');
        }
        revisionRef.current = remote.revision; basePayloadRef.current = remote.payload!;
        lastAttemptedJsonRef.current = '';
      } catch { if (!cancelled) setSyncStatus('error'); }
    })();
    return () => { cancelled = true; };
  }, [plannerState.data?.revision, unlocked, data, openRecovery, persistLocal, setData]);

  const unlockPlanner = async (event: FormEvent) => {
    event.preventDefault(); setPassphraseError('');
    if (busyRef.current || !ownerId) return;
    if (passphrase.length < 10) { setPassphraseError('Use your separate passphrase (at least 10 characters).'); return; }
    busyRef.current = true; setBusy(true);
    const generation = epoch.current;
    try {
      const cache = readAccountCache(localStorage, ownerId);
      const legacy = cache ? null : readLegacyCache(localStorage);
      // Legacy caches lack ownership: require explicit recovery before attributing them.
      if (legacy && !window.confirm('This browser has an older encrypted offline copy without account ownership. Continue only if it belongs to this account. It will be preserved for recovery.')) return;
      const refreshed = navigator.onLine ? await plannerState.refetch() : null;
      if (generation !== epoch.current) return;
      const remote = refreshed?.data ?? (!navigator.onLine ? undefined : plannerState.data);
      const localPayload = cache?.payload ?? legacy;
      if (!remote && !localPayload) throw new Error('Reconnect before setting up encryption. No offline copy is available.');
      const cloudPayload = refreshed?.isError ? undefined : remote?.payload;
      if (!cloudPayload && !localPayload && localStorage.getItem('daybook.local.v1')
        && !window.confirm('This browser has an older unencrypted planner without account ownership. Use it for this account only if it is yours.')) return;
      const salt = cloudPayload?.salt ?? localPayload?.salt ?? randomBase64(32);
      if (!cloudPayload && !localPayload && passphrase !== passphraseAgain) throw new Error('Those passphrases do not match.');
      const key = await deriveKey(passphrase, salt);
      const cloud = cloudPayload ? await decryptSnapshot(cloudPayload, key) : null;
      let local: Data | null = null;
      let base: Data | null = null;
      if (localPayload) {
        const localKey = localPayload.salt === salt ? key : await deriveKey(passphrase, localPayload.salt);
        local = await decryptSnapshot(localPayload, localKey);
        if (cache?.basePayload) {
          const baseKey = cache.basePayload.salt === salt ? key : await deriveKey(passphrase, cache.basePayload.salt);
          base = await decryptSnapshot(cache.basePayload, baseKey);
        }
      }
      if (generation !== epoch.current) return;
      cryptoKeyRef.current = key; saltRef.current = salt;
      revisionRef.current = cloudPayload ? remote?.revision ?? 0 : cache?.baseRevision ?? 0;
      basePayloadRef.current = cloudPayload ?? cache?.basePayload;
      lastSavedJsonRef.current = cloud ? JSON.stringify(cloud) : base ? JSON.stringify(base) : '';
      lastAttemptedJsonRef.current = '';
      if (cloud && local && (cache?.dirty || legacy || (remote?.revision ?? 0) < (cache?.baseRevision ?? 0))
        && JSON.stringify(local) !== JSON.stringify(cloud)) {
        await openRecovery(local, cloud, base, localPayload!, cloudPayload!, !!legacy);
      } else {
        const restored = cloud ?? local ?? dataRef.current;
        if (legacy) preserveRecoveryCopies(localStorage, ownerId, legacy);
        // Persist BEFORE making the snapshot editable or removing any legacy state.
        await persistLocal(restored);
        if (generation !== epoch.current) return;
        setData(restored); readyRef.current = true; setUnlocked(true);
        setSyncStatus(cloud ? 'ready' : navigator.onLine ? 'queued' : 'offline');
        localStorage.removeItem('daybook.local.v1');
      }
      setPassphrase(''); setPassphraseAgain('');
    } catch (error) {
      cryptoKeyRef.current = null; readyRef.current = false;
      setPassphraseError(error instanceof Error && /Reconnect|match|offline copy needs|saved offline copy needs/.test(error.message)
        ? error.message : 'Could not open or safely save your planner. Check your passphrase and browser storage. Existing encrypted copies have not been discarded.');
    } finally { busyRef.current = false; setBusy(false); }
  };
  const acceptRecovery = async () => {
    if (!recovery || !cryptoKeyRef.current || busyRef.current) return;
    busyRef.current = true; setBusy(true); setPassphraseError('');
    const generation = recoveryGeneration.current;
    try {
      await persistLocal(recovery.merged);
      if (generation !== epoch.current) return;
      setData(recovery.merged); readyRef.current = true; setRecovery(null); setUnlocked(true);
      setSyncStatus(navigator.onLine ? 'queued' : 'offline');
    } catch { setPassphraseError('Recovery could not be saved on this device. Both original copies are still preserved. Free browser storage and retry.'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const lockPlanner = async () => {
    const wasReady = readyRef.current;
    readyRef.current = false; setUnlocked(false);
    // Invalidate network callbacks immediately, but keep the key just long enough to cache the latest edit.
    epoch.current++;
    try { if (wasReady && cryptoKeyRef.current) await persistLocal(dataRef.current); }
    catch {
      readyRef.current = wasReady; setUnlocked(wasReady); setSyncStatus('error');
      setPassphraseError('Could not lock safely because the latest edit could not be cached. Keep this tab open, export a backup or free browser storage, then retry.');
      return false;
    }
    invalidate(); setRecovery(null); setPassphrase(''); setPassphraseAgain('');
    onLockRef.current();
    return true;
  };
  const checkpointBeforeReplace = async () => {
    const key = cryptoKeyRef.current;
    if (!key || !readyRef.current || !ownerId) throw new Error('Unlock your planner first.');
    const generation = epoch.current;
    const serialized = JSON.stringify(dataRef.current);
    const payload = await encryptSnapshot(dataRef.current, key, saltRef.current);
    if (generation !== epoch.current || !readyRef.current || JSON.stringify(dataRef.current) !== serialized) {
      throw new Error('Your planner changed while preparing recovery. Review and try again.');
    }
    // Preserve older checkpoints too; the fixed key exposes the latest one in Settings.
    preserveRecoveryCopies(localStorage, ownerId, payload);
    localStorage.setItem(preImportKey(ownerId), JSON.stringify(payload));
  };
  const restorePreImport = async () => {
    const raw = localStorage.getItem(preImportKey(ownerId));
    const key = cryptoKeyRef.current;
    if (!raw || !key || !readyRef.current) throw new Error('No recovery snapshot is available for this account.');
    const generation = epoch.current;
    const restored = await decryptSnapshot(JSON.parse(raw), key);
    await checkpointBeforeReplace();
    if (generation !== epoch.current || !readyRef.current) throw new Error('Unlock this account and retry.');
    setData(restored);
  };
  return { ownerId, plannerState, saveMutation: { ...saveMutation, isPending: saveMutation.isPending || busy },
    passphrase, setPassphrase, passphraseAgain, setPassphraseAgain,
    passphraseError, unlocked, online, syncStatus, recovery, busy, unlockPlanner, acceptRecovery, lockPlanner,
    checkpointBeforeReplace, restorePreImport, cryptoKeyRef, readyRef,
    hasCache: hasStoredCache(ownerId),
    syncNow: () => { lastAttemptedJsonRef.current = ''; void saveEncrypted(dataRef.current); } };
}
