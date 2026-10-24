import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Network from 'expo-network';
import {
  useGetPlannerState,
  useSavePlannerState,
} from '@workspace/api-client-react';
import type {
  EncryptedPlannerPayload,
  PlannerState,
} from '@workspace/api-client-react';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Linking, Platform } from 'react-native';
import {
  decodeBase64,
  decryptPlannerPayload,
  decryptPlannerPayloadWithKey,
  encodeBase64,
  encryptPlannerData,
  parseEncryptedPayload,
  derivePlannerKey,
  IV_BYTES,
  SALT_BYTES,
} from '@/lib/crypto';
import {
  createLocalId,
  EMPTY_PLANNER_DATA,
  mergePlannerData,
  parsePlannerData,
  plannerCacheKey,
  type PlannerData,
  type InboxItem,
  type PlannerHabit,
  type PlannerNote,
  type PlannerProject,
  type PlannerRoutine,
  type PlannerTask,
  type PlannerGoal,
  type PlannerLifeArea,
  type PlannerLifeReview,
  type PlannerMilestone,
  type PlannerRecordRef,
} from '@/lib/planner-data';
import {
  addPlannerTombstone,
  canSetTaskParent,
  convertInboxItemToNote,
  convertInboxItemToTask,
  deletePlannerRoutineRun,
  pausePlannerHabit,
  resumePlannerHabit,
  setPlannerHabitCompleted,
  setPlannerHabitProgress,
  setPlannerHabitSkipped,
  setPlannerRoutineStepCompletion,
  startPlannerRoutineRun,
  updatePlannerTaskOccurrence,
} from '@workspace/planner-contract';
import { localDateKey } from '@/lib/planner-data';
import {
  linkPlannerRecords,
  markReleaseTwoDataUsed,
  saveLifeReview as saveLifeReviewRecord,
  unlinkPlannerRecord,
} from '@workspace/planner-contract/release2';
import {
  askForReminderPermission,
  cancelLocalTaskReminders,
  readReminderPermission,
  reconcileLocalTaskReminders,
  type ReminderPermissionState,
} from '@/lib/local-task-reminders';

type CacheRecord = {
  revision: number;
  payload: EncryptedPlannerPayload;
};

type CacheState = 'loading' | 'missing' | 'valid' | 'invalid';
export type SyncStatus = 'checking' | 'ready' | 'queued' | 'syncing' | 'offline' | 'error' | 'conflict';
type EditablePlannerTask = Pick<PlannerTask, 'title' | 'dueDate' | 'dueTime' | 'tag'> &
  Partial<Pick<PlannerTask, 'description' | 'priority' | 'parentTaskId' | 'recurrence' | 'reminder'>> &
  { projectId?: string | null } &
  Record<string, unknown>;
type EditablePlannerNote = Pick<PlannerNote, 'title' | 'content' | 'date' | 'tags'> &
  Record<string, unknown>;

export type PlannerContextValue = {
  data: PlannerData;
  isUnlocked: boolean;
  isChecking: boolean;
  isNewPlanner: boolean;
  isOnline: boolean;
  isReadOnly: boolean;
  syncStatus: SyncStatus;
  syncNotice: string;
  unlockError: string;
  cloudState: PlannerState | undefined;
  toggleTask: (id: string, occurrenceDate?: string, seriesTaskId?: string, completed?: boolean) => void;
  saveTask: (task: EditablePlannerTask, id?: string, occurrenceDate?: string) => void;
  deleteTask: (id: string, occurrenceDate?: string, seriesTaskId?: string) => void;
  saveProject: (project: Omit<PlannerProject, 'id'>, id?: string) => void;
  deleteProject: (id: string) => void;
  saveGoal: (goal: Omit<PlannerGoal, 'id'>, id?: string) => void;
  saveMilestone: (milestone: Omit<PlannerMilestone, 'id'>, id?: string) => void;
  saveLifeArea: (area: Omit<PlannerLifeArea, 'id'>, id?: string) => void;
  saveLifeReview: (review: PlannerLifeReview) => void;
  linkRecords: (source: PlannerRecordRef, target: PlannerRecordRef) => boolean;
  unlinkRecord: (linkId: string) => boolean;
  saveInbox: (title: string, content: string, id?: string) => void;
  deleteInbox: (id: string) => void;
  convertInboxToTask: (id: string) => boolean;
  convertInboxToNote: (id: string) => boolean;
  saveHabit: (habit: Omit<PlannerHabit, 'id'>, id?: string) => void;
  deleteHabit: (id: string) => void;
  toggleHabit: (id: string, date?: string) => void;
  setHabitProgress: (id: string, date: string, value: number) => void;
  setHabitSkipped: (id: string, date: string, skipped: boolean) => void;
  pauseHabit: (id: string, startDate: string, endDate?: string) => void;
  resumeHabit: (id: string, date: string) => void;
  saveRoutine: (routine: Omit<PlannerRoutine, 'id'>, id?: string) => void;
  startRoutine: (id: string) => void;
  completeRoutineStep: (routineId: string, runId: string, stepId: string, completed?: boolean) => void;
  deleteRoutineRun: (routineId: string, runId: string) => void;
  deleteRoutine: (id: string) => void;
  saveNote: (note: EditablePlannerNote, id?: string) => void;
  deleteNote: (id: string) => void;
  updateSettings: (values: Partial<PlannerData['settings']>) => void;
  unlock: (passphrase: string, confirmation?: string) => Promise<boolean>;
  lock: () => void;
  syncNow: () => Promise<void>;
  retryCloud: () => Promise<void>;
  reminderPermission: ReminderPermissionState | null;
  remindersSupported: boolean;
  requestReminderPermission: () => Promise<boolean>;
  openReminderSettings: () => Promise<void>;
};

export const PlannerContext = createContext<PlannerContextValue | null>(null);

function readCacheRecord(value: string | null): CacheRecord | 'invalid' | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as Partial<CacheRecord>;
    const payload = parseEncryptedPayload(parsed.payload);
    if (
      !payload ||
      typeof parsed.revision !== 'number' ||
      !Number.isInteger(parsed.revision) ||
      parsed.revision < 0
    ) {
      return 'invalid';
    }
    return { revision: parsed.revision, payload };
  } catch {
    return 'invalid';
  }
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as {
    status?: number;
    response?: { status?: number };
  };
  return candidate.status ?? candidate.response?.status;
}

function makeId(): string {
  return createLocalId(Crypto.getRandomBytes(16));
}

function snapshotHasPayload(snapshot: PlannerState | undefined): boolean {
  return Boolean(snapshot?.exists && snapshot.payload);
}

export function PlannerProvider({
  accountId,
  children,
}: {
  accountId: string;
  children: ReactNode;
}) {
  const cacheKey = useMemo(() => plannerCacheKey(accountId), [accountId]);
  const [data, setData] = useState<PlannerData>(EMPTY_PLANNER_DATA);
  const dataRef = useRef<PlannerData>(EMPTY_PLANNER_DATA);
  const [cacheRecord, setCacheRecord] = useState<CacheRecord | null>(null);
  const [cacheState, setCacheState] = useState<CacheState>('loading');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const unlockedRef = useRef(false);
  const [isOnline, setIsOnline] = useState(true);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const readOnlyRef = useRef(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('checking');
  const [syncNotice, setSyncNotice] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [reminderPermission, setReminderPermission] = useState<ReminderPermissionState | null>(null);
  const [reminderRescheduleToken, setReminderRescheduleToken] = useState(0);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [conflictCount, setConflictCount] = useState(0);
  const keyRef = useRef<Uint8Array | null>(null);
  const saltRef = useRef<Uint8Array | null>(null);
  const revisionRef = useRef(0);
  const lastSyncedJsonRef = useRef('');
  const syncPromiseRef = useRef<Promise<void> | null>(null);
  const syncRequestedRef = useRef(false);
  const cacheWriteRef = useRef<Promise<void>>(Promise.resolve());
  const snapshotQuery = useGetPlannerState({
    query: {
      queryKey: ['/api/planner/state'],
      refetchInterval: isOnline ? 15_000 : false,
      refetchOnReconnect: true,
      retry: 1,
    },
  });
  const { mutateAsync: saveSnapshot } = useSavePlannerState();
  const refetchSnapshot = snapshotQuery.refetch;

  const requestReminderPermission = useCallback(async () => {
    if (Platform.OS === 'web') return false;
    try {
      const permission = await askForReminderPermission();
      setReminderPermission(permission);
      return permission.granted;
    } catch {
      return false;
    }
  }, []);
  const openReminderSettings = useCallback(async () => {
    if (Platform.OS === 'web') return;
    try {
      await Linking.openSettings();
    } catch {
      // The user can still manage notification access from the device settings app.
    }
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (Platform.OS === 'web') {
        if (active) setReminderPermission({ granted: false, canAskAgain: false, status: 'unsupported' });
        return;
      }
      try {
        const permission = await readReminderPermission();
        if (active) setReminderPermission(permission);
      } catch {
        if (active) setReminderPermission({ granted: false, canAskAgain: false, status: 'unavailable' });
      }
    };
    void refresh();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setCacheState('loading');
    void AsyncStorage.getItem(cacheKey)
      .then((raw) => {
        if (cancelled) return;
        const record = readCacheRecord(raw);
        if (record === 'invalid') {
          setCacheRecord(null);
          setCacheState('invalid');
          return;
        }
        setCacheRecord(record);
        setCacheState(record ? 'valid' : 'missing');
      })
      .catch(() => {
        if (!cancelled) {
          setCacheRecord(null);
          setCacheState('invalid');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey]);

  useEffect(() => {
    let active = true;
    const applyNetwork = (state: Network.NetworkState) => {
      setIsOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
    };
    void Network.getNetworkStateAsync()
      .then((state) => {
        if (active) applyNetwork(state);
      })
      .catch(() => {
        if (active) setIsOnline(true);
      });
    const subscription = Network.addNetworkStateListener(applyNetwork);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const persistCache = useCallback(
    (snapshot: PlannerData, revision = revisionRef.current) => {
      const key = keyRef.current;
      const salt = saltRef.current;
      if (!key || !salt) return Promise.resolve();
      const payload = encryptPlannerData(
        snapshot,
        key,
        salt,
        Crypto.getRandomBytes(IV_BYTES),
      );
      const record: CacheRecord = { revision, payload };
      const serialized = JSON.stringify(record);
      cacheWriteRef.current = cacheWriteRef.current
        .catch(() => undefined)
        .then(() => AsyncStorage.setItem(cacheKey, serialized))
        .then(() => {
          setCacheRecord(record);
          setCacheState('valid');
        });
      return cacheWriteRef.current;
    },
    [cacheKey],
  );

  const setPlannerData = useCallback((next: PlannerData) => {
    dataRef.current = next;
    setData(next);
    dirtyRef.current = true;
    setDirty(true);
    setSyncStatus(isOnline ? 'queued' : 'offline');
  }, [isOnline]);

  const syncNow = useCallback(async (): Promise<void> => {
    if (!unlockedRef.current || !keyRef.current || !saltRef.current || readOnlyRef.current) {
      return;
    }
    if (!isOnline) {
      setSyncStatus('offline');
      await persistCache(dataRef.current);
      return;
    }
    if (syncPromiseRef.current) {
      syncRequestedRef.current = true;
      return syncPromiseRef.current;
    }

    const work = (async () => {
      let attempts = 0;
      do {
        syncRequestedRef.current = false;
        attempts += 1;
        const snapshot = dataRef.current;
        const serialized = JSON.stringify(snapshot);
        const key = keyRef.current;
        const salt = saltRef.current;
        if (!key || !salt || readOnlyRef.current) return;
        setSyncStatus('syncing');
        try {
          await persistCache(snapshot, revisionRef.current);
          const payload = encryptPlannerData(
            snapshot,
            key,
            salt,
            Crypto.getRandomBytes(IV_BYTES),
          );
          const result = await saveSnapshot({
            data: { expectedRevision: revisionRef.current, payload },
          });
          revisionRef.current = result.revision;
          lastSyncedJsonRef.current = serialized;
          if (JSON.stringify(dataRef.current) === serialized) {
            dirtyRef.current = false;
            setDirty(false);
            setSyncStatus('ready');
            setSyncNotice(
              conflictCount > 0
                ? `Both versions were kept. Review ${conflictCount} item${conflictCount === 1 ? '' : 's'} marked “Conflict copy”.`
                : '',
            );
          } else {
            dirtyRef.current = true;
            setDirty(true);
            syncRequestedRef.current = true;
          }
          await cacheWriteRef.current;
          if (JSON.stringify(dataRef.current) === serialized) {
            const savedRecord: CacheRecord = {
              revision: result.revision,
              payload: result.payload,
            };
            await AsyncStorage.setItem(cacheKey, JSON.stringify(savedRecord));
            setCacheRecord(savedRecord);
            setCacheState('valid');
          }
        } catch (error) {
          if (errorStatus(error) !== 409) {
            setSyncStatus(isOnline ? 'error' : 'offline');
            setSyncNotice(
              isOnline
                ? 'Your encrypted changes remain on this device. Retry sync when the connection is stable.'
                : 'Offline changes are encrypted on this device and will sync when you reconnect.',
            );
            return;
          }

          setSyncStatus('conflict');
          const latest = await refetchSnapshot();
          const remote = latest.data;
          if (!remote?.payload) {
            setIsReadOnly(true);
            readOnlyRef.current = true;
            setSyncNotice('The cloud snapshot changed. Open the web planner to review it before editing here.');
            return;
          }
          if (remote.payload.salt !== encodeBase64(salt)) {
            setIsReadOnly(true);
            readOnlyRef.current = true;
            setSyncNotice('The cloud encryption settings differ. Editing is paused to protect both copies.');
            return;
          }
          try {
            const remoteData = parsePlannerData(
              decryptPlannerPayloadWithKey(remote.payload, key),
            );
            const merged = mergePlannerData(remoteData, dataRef.current, makeId);
            revisionRef.current = remote.revision;
            lastSyncedJsonRef.current = JSON.stringify(remoteData);
            dataRef.current = merged.data;
            setData(merged.data);
            setConflictCount((count) => count + merged.conflicts);
            const needsAnotherSave =
              JSON.stringify(merged.data) !== JSON.stringify(remoteData);
            dirtyRef.current = needsAnotherSave;
            setDirty(needsAnotherSave);
            setSyncNotice(
              merged.conflicts > 0
                ? `A newer cloud version was found. Both versions were kept as labeled copies (${merged.conflicts}).`
                : 'A newer cloud version was found. Non-conflicting changes were merged.',
            );
            syncRequestedRef.current = needsAnotherSave;
            if (!needsAnotherSave) setSyncStatus('ready');
          } catch {
            setIsReadOnly(true);
            readOnlyRef.current = true;
            setSyncNotice('The newer cloud version could not be safely decrypted. Editing is paused.');
            return;
          }
        }
      } while (syncRequestedRef.current && attempts < 3);

      if (syncRequestedRef.current) {
        setSyncStatus('conflict');
        setSyncNotice('The planner changed repeatedly on another device. Review it, then retry sync.');
      }
    })();

    syncPromiseRef.current = work.finally(() => {
      syncPromiseRef.current = null;
    });
    return syncPromiseRef.current;
  }, [
    cacheKey,
    conflictCount,
    isOnline,
    persistCache,
    refetchSnapshot,
    saveSnapshot,
  ]);

  const unlock = useCallback(
    async (passphrase: string, confirmation?: string): Promise<boolean> => {
      setUnlockError('');
      if (passphrase.length < 10) {
        setUnlockError('Use at least 10 characters for the separate encryption passphrase.');
        return false;
      }

      const cloud = snapshotQuery.data;
      const cloudPayload = cloud?.payload;
      try {
        if (cloudPayload) {
          const cloudSalt = decodeBase64(cloudPayload.salt);
          const key = derivePlannerKey(passphrase, cloudSalt);
          const cloudData = parsePlannerData(
            decryptPlannerPayloadWithKey(cloudPayload, key),
          );
          let restored = cloudData;
          let readOnly = cacheState === 'invalid';
          let notice = readOnly
            ? 'The device cache could not be read and has not been replaced. The cloud copy is open read-only.'
            : '';
          let conflicts = 0;
          let hasLocalChanges = false;

          if (cacheRecord) {
            try {
              const localData = parsePlannerData(
                decryptPlannerPayload(cacheRecord.payload, passphrase),
              );
              if (cacheRecord.revision > cloud.revision) {
                restored = localData;
                readOnly = true;
                notice = 'The device has a newer saved revision than the cloud. This copy is read-only until recovery is reviewed on the web.';
              } else if (cacheRecord.revision === cloud.revision) {
                restored = localData;
                hasLocalChanges = JSON.stringify(restored) !== JSON.stringify(cloudData);
              } else {
                const merged = mergePlannerData(cloudData, localData, makeId);
                restored = merged.data;
                conflicts = merged.conflicts;
                hasLocalChanges = JSON.stringify(restored) !== JSON.stringify(cloudData);
                if (conflicts > 0) {
                  notice = `Both copies were kept. Review ${conflicts} item${conflicts === 1 ? '' : 's'} marked “Conflict copy”.`;
                }
              }
            } catch {
              readOnly = true;
              notice = 'The local encrypted copy could not be opened with this passphrase. The cloud copy is open read-only; the device cache was left untouched.';
            }
          }

          keyRef.current = key;
          saltRef.current = cloudSalt;
          revisionRef.current = cloud.revision;
          lastSyncedJsonRef.current = JSON.stringify(cloudData);
          readOnlyRef.current = readOnly;
          setIsReadOnly(readOnly);
          dirtyRef.current = hasLocalChanges && !readOnly;
          setDirty(hasLocalChanges && !readOnly);
          dataRef.current = restored;
          setData(restored);
          setConflictCount(conflicts);
          setSyncNotice(notice);
          unlockedRef.current = true;
          setIsUnlocked(true);
          setSyncStatus(isOnline ? (hasLocalChanges ? 'queued' : 'ready') : 'offline');
          return true;
        }

        if (cacheRecord) {
          const salt = decodeBase64(cacheRecord.payload.salt);
          const key = derivePlannerKey(passphrase, salt);
          const restored = parsePlannerData(
            decryptPlannerPayloadWithKey(cacheRecord.payload, key),
          );
          const confirmedEmptyCloud =
            Boolean(cloud && !cloud.exists && cacheRecord.revision > 0);
          const localChangesAgainstEmpty =
            Boolean(cloud && !cloud.exists && cacheRecord.revision === 0) &&
            JSON.stringify(restored) !== JSON.stringify(EMPTY_PLANNER_DATA);
          const localChangesWhileCloudUnavailable =
            !cloud && (snapshotQuery.isError || !isOnline);
          const hasLocalChanges = localChangesAgainstEmpty || localChangesWhileCloudUnavailable;
          const readOnly = cacheState === 'invalid' || confirmedEmptyCloud;
          keyRef.current = key;
          saltRef.current = salt;
          revisionRef.current = cacheRecord.revision;
          lastSyncedJsonRef.current = '';
          readOnlyRef.current = readOnly;
          setIsReadOnly(readOnly);
          dataRef.current = restored;
          setData(restored);
          dirtyRef.current = hasLocalChanges && !readOnly;
          setDirty(hasLocalChanges && !readOnly);
          setSyncNotice(
            confirmedEmptyCloud
              ? 'This device has an older saved revision, but the cloud is empty. The copy is read-only until recovery is reviewed on the web.'
              : snapshotQuery.isError
                ? 'Cloud is unavailable. This encrypted device copy stays available while you are offline.'
                : '',
          );
          unlockedRef.current = true;
          setIsUnlocked(true);
          setSyncStatus(
            isOnline
              ? hasLocalChanges && !readOnly ? 'queued' : 'ready'
              : 'offline',
          );
          return true;
        }

        if (!cloud || snapshotQuery.isError || cacheState === 'invalid') {
          setUnlockError(
            'Cloud storage is unavailable and no verified encrypted copy exists on this device. Reconnect before setting up encryption.',
          );
          return false;
        }
        if (confirmation !== passphrase) {
          setUnlockError('Those encryption passphrases do not match.');
          return false;
        }

        const salt = Crypto.getRandomBytes(SALT_BYTES);
        const key = derivePlannerKey(passphrase, salt);
        keyRef.current = key;
        saltRef.current = salt;
        revisionRef.current = cloud.revision;
        lastSyncedJsonRef.current = '';
        readOnlyRef.current = false;
        setIsReadOnly(false);
        dataRef.current = EMPTY_PLANNER_DATA;
        setData(EMPTY_PLANNER_DATA);
        dirtyRef.current = true;
        setDirty(true);
        setSyncNotice('');
        unlockedRef.current = true;
        setIsUnlocked(true);
        setSyncStatus(isOnline ? 'queued' : 'offline');
        return true;
      } catch {
        setUnlockError('That passphrase did not unlock Buhay.OS. Check it carefully; it cannot be recovered.');
        return false;
      }
    },
    [cacheRecord, cacheState, isOnline, snapshotQuery.data, snapshotQuery.isError],
  );

  const lock = useCallback(() => {
    keyRef.current = null;
    saltRef.current = null;
    unlockedRef.current = false;
    readOnlyRef.current = false;
    dirtyRef.current = false;
    revisionRef.current = 0;
    lastSyncedJsonRef.current = '';
    setIsUnlocked(false);
    setIsReadOnly(false);
    setDirty(false);
    setData(EMPTY_PLANNER_DATA);
    dataRef.current = EMPTY_PLANNER_DATA;
    setUnlockError('');
    setSyncNotice('');
    setSyncStatus('checking');
  }, []);

  useEffect(() => {
    if (!isUnlocked || !dirty || isReadOnly) return;
    const timer = setTimeout(() => {
      void syncNow();
    }, 850);
    return () => clearTimeout(timer);
  }, [data, dirty, isOnline, isReadOnly, isUnlocked, syncNow]);

  useEffect(() => {
    if (!isUnlocked || !keyRef.current || !saltRef.current || isReadOnly) return;
    if (!snapshotQuery.data?.payload || snapshotQuery.data.revision <= revisionRef.current) return;
    const remote = snapshotQuery.data;
    const remotePayload = remote.payload;
    if (!remotePayload) return;
    const key = keyRef.current;
    const salt = saltRef.current;
    if (remotePayload.salt !== encodeBase64(salt)) {
      readOnlyRef.current = true;
      setIsReadOnly(true);
      setSyncStatus('conflict');
      setSyncNotice('The other device uses a different encryption profile. Editing is paused to protect both copies.');
      return;
    }
    try {
      const remoteData = parsePlannerData(
        decryptPlannerPayloadWithKey(remotePayload, key),
      );
      const shouldMergeLocal =
        dirtyRef.current ||
        (lastSyncedJsonRef.current !== '' &&
          JSON.stringify(dataRef.current) !== lastSyncedJsonRef.current);
      const merged = shouldMergeLocal
        ? mergePlannerData(remoteData, dataRef.current, makeId)
        : { data: remoteData, conflicts: 0 };
      revisionRef.current = remote.revision;
      lastSyncedJsonRef.current = JSON.stringify(remoteData);
      dataRef.current = merged.data;
      setData(merged.data);
      setConflictCount((count) => count + merged.conflicts);
      const changed = JSON.stringify(merged.data) !== JSON.stringify(remoteData);
      dirtyRef.current = changed;
      setDirty(changed);
      setSyncStatus(changed ? 'queued' : 'ready');
      setSyncNotice(
        merged.conflicts > 0
          ? `A newer cloud version was found. Both versions were kept as labeled copies (${merged.conflicts}).`
          : '',
      );
    } catch {
      readOnlyRef.current = true;
      setIsReadOnly(true);
      setSyncStatus('conflict');
      setSyncNotice('The newer cloud snapshot could not be safely decrypted. Editing is paused.');
    }
  }, [isReadOnly, isUnlocked, snapshotQuery.data]);

  useEffect(() => {
    if (!isUnlocked || isReadOnly || !keyRef.current) return;
    void persistCache(data, revisionRef.current).catch(() => {
      setSyncStatus('error');
      setSyncNotice('The encrypted offline copy could not be updated. Keep the app open and retry sync.');
    });
  }, [data, isReadOnly, isUnlocked, persistCache]);

  useEffect(() => {
    if (isOnline) {
      setSyncStatus((current) => current === 'offline' ? (dirtyRef.current ? 'queued' : 'ready') : current);
      void snapshotQuery.refetch();
      if (dirtyRef.current && unlockedRef.current) void syncNow();
    } else if (unlockedRef.current) {
      setSyncStatus('offline');
    }
  }, [isOnline, snapshotQuery.refetch, syncNow]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void snapshotQuery.refetch();
        if (dirtyRef.current) void syncNow();
        setReminderRescheduleToken((token) => token + 1);
        if (Platform.OS !== 'web') {
          void readReminderPermission().then(setReminderPermission).catch(() => undefined);
        }
      }
    });
    return () => subscription.remove();
  }, [snapshotQuery.refetch, syncNow]);

  useEffect(() => {
    if (Platform.OS === 'web' || !isUnlocked || !reminderPermission || reminderPermission.status === 'unavailable') return;
    void reconcileLocalTaskReminders(
      data.tasks,
      reminderPermission.granted,
      new Date(),
      data.settings.showTaskTitlesInReminders !== false,
    ).catch(() => {
      setSyncNotice('A local reminder could not be scheduled. Check notification access and try again.');
    });
  }, [data.tasks, data.settings.showTaskTitlesInReminders, isUnlocked, reminderPermission, reminderRescheduleToken]);

  useEffect(() => () => {
    if (Platform.OS !== 'web') void cancelLocalTaskReminders().catch(() => undefined);
  }, []);

  const toggleTask = useCallback((id: string, occurrenceDate?: string, seriesTaskId?: string, desiredCompleted?: boolean) => {
    if (readOnlyRef.current) return;
    if (occurrenceDate && seriesTaskId) {
      const series = dataRef.current.tasks.find((task) => task.id === seriesTaskId);
      const override = series?.occurrenceOverrides?.find((entry) => entry.date === occurrenceDate);
      const currentDone = override?.changes?.completed ?? series?.completed ?? false;
      setPlannerData(updatePlannerTaskOccurrence(dataRef.current, seriesTaskId, occurrenceDate, {
        completed: desiredCompleted ?? !currentDone,
      }, new Date().toISOString()));
      return;
    }
    const task = dataRef.current.tasks.find((item) => item.id === id);
    if (!task) return;
    const children = dataRef.current.tasks.filter((item) => item.parentTaskId === id);
    const completed = children.length
      ? !children.every((item) => item.completed)
      : !task.completed;
    setPlannerData({
      ...dataRef.current,
      tasks: dataRef.current.tasks.map((task) =>
        task.id === id || task.parentTaskId === id
          ? { ...task, completed }
          : task,
      ),
    });
  }, [setPlannerData]);

  const saveTask = useCallback(
    (task: EditablePlannerTask, id?: string, occurrenceDate?: string) => {
      if (readOnlyRef.current) return;
      if (id && occurrenceDate) {
        setPlannerData(updatePlannerTaskOccurrence(dataRef.current, id, occurrenceDate, {
          title: task.title,
          description: task.description,
          dueDate: task.dueDate,
          dueTime: task.dueTime,
          tag: task.tag,
          priority: task.priority,
          reminder: task.reminder,
        }, new Date().toISOString()));
        return;
      }
       const currentTasks = dataRef.current.tasks;
       const existing = id ? currentTasks.find((item) => item.id === id) : undefined;
       const parentTaskId = task.parentTaskId ?? existing?.parentTaskId;
       const parent = parentTaskId
         ? currentTasks.find((item) => item.id === parentTaskId)
         : undefined;
       if (!canSetTaskParent(currentTasks, parentTaskId, existing?.id)) return;
       const { projectId: requestedProjectId, ...taskFields } = task;
       const projectId = parent
         ? parent.projectId
         : Object.prototype.hasOwnProperty.call(task, 'projectId')
           ? requestedProjectId ?? undefined
           : existing?.projectId;
      const nextTask: PlannerTask = {
        ...(existing ?? {}),
         ...taskFields,
        id: existing?.id ?? makeId(),
        completed: existing?.completed ?? false,
         ...(parentTaskId ? { parentTaskId } : {}),
         ...(projectId ? { projectId } : {}),
      };
       if (!projectId) delete nextTask.projectId;
      setPlannerData({
        ...dataRef.current,
         tasks: existing
           ? currentTasks.map((item) => {
               if (item.id === id) return nextTask;
               if (
                 item.parentTaskId === id &&
                 item.projectId !== nextTask.projectId
               ) {
                 if (nextTask.projectId) return { ...item, projectId: nextTask.projectId };
                 const { projectId: _projectId, ...child } = item;
                 return child;
               }
               return item;
             })
           : [nextTask, ...currentTasks],
      });
    },
    [setPlannerData],
  );

  const deleteTask = useCallback((id: string, occurrenceDate?: string, seriesTaskId?: string) => {
    if (readOnlyRef.current) return;
    if (occurrenceDate && seriesTaskId) {
      setPlannerData(updatePlannerTaskOccurrence(dataRef.current, seriesTaskId, occurrenceDate, undefined, new Date().toISOString(), true));
      return;
    }
    const current = dataRef.current;
    const deleted = current.tasks.find((task) => task.id === id);
    if (!deleted) return;
    const withTombstone = addPlannerTombstone(current, 'tasks', deleted);
    setPlannerData({
      ...withTombstone,
      tasks: current.tasks
        .filter((task) => task.id !== id)
        .map((task) =>
          task.parentTaskId === id
            ? { ...task, parentTaskId: undefined }
            : task,
        ),
    });
  }, [setPlannerData]);

  const saveProject = useCallback(
    (project: Omit<PlannerProject, 'id'>, id?: string) => {
      if (readOnlyRef.current) return;
      const existing = id
        ? dataRef.current.projects?.find((item) => item.id === id)
        : undefined;
      const nextProject: PlannerProject = {
        ...(existing ?? {}),
        ...project,
        id: existing?.id ?? makeId(),
      };
      setPlannerData({
        ...dataRef.current,
        projects: existing
          ? (dataRef.current.projects ?? []).map((item) =>
              item.id === id ? nextProject : item,
            )
          : [...(dataRef.current.projects ?? []), nextProject],
      });
    },
    [setPlannerData],
  );

  const deleteProject = useCallback((id: string) => {
    if (readOnlyRef.current) return;
    const current = dataRef.current;
    const deleted = current.projects?.find((project) => project.id === id);
    if (!deleted) return;
    const withTombstone = addPlannerTombstone(current, 'projects', deleted);
    setPlannerData({
      ...withTombstone,
      projects: (current.projects ?? []).filter((project) => project.id !== id),
      tasks: current.tasks.map((task) => {
        if (task.projectId !== id) return task;
        const { projectId: _projectId, ...unassigned } = task;
        return unassigned as PlannerTask;
      }),
    });
  }, [setPlannerData]);

  const saveGoal = useCallback((goal: Omit<PlannerGoal, 'id'>, id?: string) => {
    if (readOnlyRef.current) return;
    const current = dataRef.current.goals ?? [];
    const existing = id ? current.find((item) => item.id === id) : undefined;
    const next: PlannerGoal = { ...(existing ?? {}), ...goal, id: existing?.id ?? makeId() };
    if (goal.description === undefined) delete next.description;
    if (goal.targetDate === undefined) delete next.targetDate;
    setPlannerData(markReleaseTwoDataUsed({
      ...dataRef.current,
      goals: existing
        ? current.map((item) => item.id === id ? next : item)
        : [...current, next],
    }));
  }, [setPlannerData]);

  const saveMilestone = useCallback((milestone: Omit<PlannerMilestone, 'id'>, id?: string) => {
    if (readOnlyRef.current) return;
    const current = dataRef.current.milestones ?? [];
    const existing = id ? current.find((item) => item.id === id) : undefined;
    const next: PlannerMilestone = { ...(existing ?? {}), ...milestone, id: existing?.id ?? makeId() };
    if (milestone.targetDate === undefined) delete next.targetDate;
    setPlannerData(markReleaseTwoDataUsed({
      ...dataRef.current,
      milestones: existing
        ? current.map((item) => item.id === id ? next : item)
        : [...current, next],
    }));
  }, [setPlannerData]);

  const saveLifeArea = useCallback((area: Omit<PlannerLifeArea, 'id'>, id?: string) => {
    if (readOnlyRef.current) return;
    const current = dataRef.current.lifeAreas ?? [];
    const existing = id ? current.find((item) => item.id === id) : undefined;
    const next: PlannerLifeArea = { ...(existing ?? {}), ...area, id: existing?.id ?? makeId() };
    if (area.description === undefined) delete next.description;
    if (area.colorHex === undefined) delete next.colorHex;
    setPlannerData(markReleaseTwoDataUsed({
      ...dataRef.current,
      lifeAreas: existing
        ? current.map((item) => item.id === id ? next : item)
        : [...current, next],
    }));
  }, [setPlannerData]);

  const saveLifeReview = useCallback((review: PlannerLifeReview) => {
    if (readOnlyRef.current) return;
    try {
      setPlannerData(saveLifeReviewRecord(dataRef.current, review));
    } catch {
      // Invalid or stale review drafts are left unchanged in the planner.
    }
  }, [setPlannerData]);

  const linkRecords = useCallback((source: PlannerRecordRef, target: PlannerRecordRef) => {
    if (readOnlyRef.current) return false;
    try {
      setPlannerData(linkPlannerRecords(dataRef.current, source, target, new Date().toISOString()));
      return true;
    } catch {
      return false;
    }
  }, [setPlannerData]);

  const unlinkRecord = useCallback((linkId: string) => {
    if (readOnlyRef.current) return false;
    try {
      setPlannerData(unlinkPlannerRecord(dataRef.current, linkId, new Date().toISOString()));
      return true;
    } catch {
      return false;
    }
  }, [setPlannerData]);

  const saveInbox = useCallback(
    (title: string, content: string, id?: string) => {
      if (readOnlyRef.current) return;
      const current = dataRef.current.inbox ?? [];
      const existing = id ? current.find((item) => item.id === id) : undefined;
      const item: InboxItem = {
        ...(existing ?? {}),
        id: existing?.id ?? makeId(),
        title: title.trim(),
        content,
        capturedAt: existing?.capturedAt ?? new Date().toISOString(),
      };
      setPlannerData({
        ...dataRef.current,
        inbox: existing
          ? current.map((candidate) => candidate.id === id ? item : candidate)
          : [item, ...current],
      });
    },
    [setPlannerData],
  );

  const deleteInbox = useCallback((id: string) => {
    if (readOnlyRef.current) return;
    const current = dataRef.current;
    const deleted = current.inbox?.find((item) => item.id === id);
    if (!deleted) return;
    const withTombstone = addPlannerTombstone(current, 'inbox', deleted);
    setPlannerData({
      ...withTombstone,
      inbox: (current.inbox ?? []).filter((item) => item.id !== id),
    });
  }, [setPlannerData]);

  const convertInboxToTask = useCallback((id: string) => {
    if (readOnlyRef.current) return false;
    const item = (dataRef.current.inbox ?? []).find((candidate) => candidate.id === id);
    if (!item) return false;
    try {
      const next = convertInboxItemToTask(dataRef.current, id, {
        id: makeId(),
        title: item.title,
        description: item.content,
        dueDate: '',
        dueTime: '',
        tag: '',
        completed: false,
        priority: 'normal',
      });
      setPlannerData(next);
      return true;
    } catch {
      return false;
    }
  }, [setPlannerData]);

  const convertInboxToNote = useCallback((id: string) => {
    if (readOnlyRef.current) return false;
    const item = (dataRef.current.inbox ?? []).find((candidate) => candidate.id === id);
    if (!item) return false;
    try {
      const next = convertInboxItemToNote(dataRef.current, id, {
        id: makeId(),
        title: item.title,
        content: item.content,
        date: localDateKey(),
        tags: [],
      });
      setPlannerData(next);
      return true;
    } catch {
      return false;
    }
  }, [setPlannerData]);

  const saveHabit = useCallback(
    (habit: Omit<PlannerHabit, 'id'>, id?: string) => {
      if (readOnlyRef.current) return;
      const current = dataRef.current.habits ?? [];
      const existing = id ? current.find((item) => item.id === id) : undefined;
      const nextHabit: PlannerHabit = {
        ...(existing ?? {}),
        ...habit,
        id: existing?.id ?? makeId(),
        completedDates: habit.completedDates ?? existing?.completedDates ?? [],
        ...(habit.completionEntries ? {} : existing?.completionEntries ? { completionEntries: existing.completionEntries } : {}),
        ...(habit.skipEntries ? {} : existing?.skipEntries ? { skipEntries: existing.skipEntries } : {}),
      };
      if (!habit.scheduledDays?.length) delete nextHabit.scheduledDays;
      if (habit.weeklyTarget === undefined) delete nextHabit.weeklyTarget;
      if (habit.measurement === undefined) delete nextHabit.measurement;
      setPlannerData({
        ...dataRef.current,
        habits: existing
          ? current.map((item) => item.id === id ? nextHabit : item)
          : [nextHabit, ...current],
      });
    },
    [setPlannerData],
  );

  const deleteHabit = useCallback((id: string) => {
    if (readOnlyRef.current) return;
    const current = dataRef.current;
    const deleted = current.habits?.find((habit) => habit.id === id);
    if (!deleted) return;
    const withTombstone = addPlannerTombstone(current, 'habits', deleted);
    setPlannerData({
      ...withTombstone,
      habits: (current.habits ?? []).filter((habit) => habit.id !== id),
    });
  }, [setPlannerData]);

  const toggleHabit = useCallback((id: string, date = localDateKey()) => {
    if (readOnlyRef.current) return;
    setPlannerData({
      ...dataRef.current,
      habits: (dataRef.current.habits ?? []).map((habit) => {
        if (habit.id !== id) return habit;
        const completed = habit.completionEntries?.filter((entry) => entry.date === date)
          .sort((left, right) => left.changedAt.localeCompare(right.changedAt)).at(-1)?.completed
          ?? habit.completedDates.includes(date);
        return {
          ...setPlannerHabitSkipped(setPlannerHabitCompleted(habit, date, !completed), date, false),
        };
      }),
    });
  }, [setPlannerData]);

  const setHabitProgress = useCallback((id: string, date: string, value: number) => {
    if (readOnlyRef.current) return;
    setPlannerData({
      ...dataRef.current,
      habits: (dataRef.current.habits ?? []).map((habit) => habit.id === id
        ? setPlannerHabitSkipped(setPlannerHabitProgress(habit, date, value, new Date().toISOString()), date, false)
        : habit),
    });
  }, [setPlannerData]);

  const setHabitSkipped = useCallback((id: string, date: string, skipped: boolean) => {
    if (readOnlyRef.current) return;
    setPlannerData({
      ...dataRef.current,
      habits: (dataRef.current.habits ?? []).map((habit) => habit.id === id ? setPlannerHabitSkipped(habit, date, skipped) : habit),
    });
  }, [setPlannerData]);

  const pauseHabit = useCallback((id: string, startDate: string, endDate?: string) => {
    if (readOnlyRef.current) return;
    setPlannerData({
      ...dataRef.current,
      habits: (dataRef.current.habits ?? []).map((habit) => habit.id === id ? pausePlannerHabit(habit, startDate, endDate) : habit),
    });
  }, [setPlannerData]);

  const resumeHabit = useCallback((id: string, date: string) => {
    if (readOnlyRef.current) return;
    setPlannerData({
      ...dataRef.current,
      habits: (dataRef.current.habits ?? []).map((habit) => habit.id === id ? resumePlannerHabit(habit, date) : habit),
    });
  }, [setPlannerData]);

  const saveRoutine = useCallback(
    (routine: Omit<PlannerRoutine, 'id'>, id?: string) => {
      if (readOnlyRef.current) return;
      const current = dataRef.current.routines ?? [];
      const existing = id ? current.find((item) => item.id === id) : undefined;
      const nextRoutine: PlannerRoutine = {
        ...(existing ?? {}),
        ...routine,
        id: existing?.id ?? makeId(),
      };
      setPlannerData({
        ...dataRef.current,
        routines: existing
          ? current.map((item) => item.id === id ? nextRoutine : item)
          : [nextRoutine, ...current],
      });
    },
    [setPlannerData],
  );

  const startRoutine = useCallback((id: string) => {
    if (readOnlyRef.current) return;
    const runId = createLocalId(Crypto.getRandomBytes(16));
    const startedAt = new Date().toISOString();
    const current = dataRef.current;
    setPlannerData({
      ...current,
      routines: (current.routines ?? []).map((routine) =>
        routine.id === id ? startPlannerRoutineRun(routine, runId, startedAt) : routine,
      ),
    });
  }, [setPlannerData]);

  const completeRoutineStep = useCallback((routineId: string, runId: string, stepId: string, completed = true) => {
    if (readOnlyRef.current) return;
    const completedAt = new Date().toISOString();
    const current = dataRef.current;
    setPlannerData({
      ...current,
      routines: (current.routines ?? []).map((routine) =>
        routine.id === routineId
          ? setPlannerRoutineStepCompletion(routine, runId, stepId, completed, completedAt)
          : routine,
      ),
    });
  }, [setPlannerData]);

  const deleteRoutineRun = useCallback((routineId: string, runId: string) => {
    if (readOnlyRef.current) return;
    const deletedAt = new Date().toISOString();
    setPlannerData({
      ...dataRef.current,
      routines: (dataRef.current.routines ?? []).map((routine) =>
        routine.id === routineId ? deletePlannerRoutineRun(routine, runId, deletedAt) : routine,
      ),
    });
  }, [setPlannerData]);

  const deleteRoutine = useCallback((id: string) => {
    if (readOnlyRef.current) return;
    const current = dataRef.current;
    const deleted = current.routines?.find((routine) => routine.id === id);
    if (!deleted) return;
    const withTombstone = addPlannerTombstone(current, 'routines', deleted);
    setPlannerData({
      ...withTombstone,
      routines: (current.routines ?? []).filter((routine) => routine.id !== id),
    });
  }, [setPlannerData]);

  const saveNote = useCallback(
      (note: EditablePlannerNote, id?: string) => {
      if (readOnlyRef.current) return;
      const existing = id ? dataRef.current.notes.find((item) => item.id === id) : undefined;
      const nextNote: PlannerNote = {
        ...(existing ?? {}),
        ...note,
        id: existing?.id ?? makeId(),
      };
      setPlannerData({
        ...dataRef.current,
        notes: existing
          ? dataRef.current.notes.map((item) => item.id === id ? nextNote : item)
          : [nextNote, ...dataRef.current.notes],
      });
    },
    [setPlannerData],
  );

  const deleteNote = useCallback((id: string) => {
    if (readOnlyRef.current) return;
    const current = dataRef.current;
    const deleted = current.notes.find((note) => note.id === id);
    if (!deleted) return;
    const withTombstone = addPlannerTombstone(current, 'notes', deleted);
    setPlannerData({
      ...withTombstone,
      notes: current.notes.filter((note) => note.id !== id),
    });
  }, [setPlannerData]);

  const updateSettings = useCallback(
    (values: Partial<PlannerData['settings']>) => {
      if (readOnlyRef.current) return;
      setPlannerData({
        ...dataRef.current,
        settings: { ...dataRef.current.settings, ...values },
      });
    },
    [setPlannerData],
  );

  const retryCloud = useCallback(async () => {
    await snapshotQuery.refetch();
  }, [snapshotQuery.refetch]);

  const contextValue = useMemo<PlannerContextValue>(
    () => ({
      data,
      isUnlocked,
      isChecking: cacheState === 'loading' || snapshotQuery.isLoading,
      isNewPlanner: Boolean(
        snapshotQuery.data && !snapshotHasPayload(snapshotQuery.data) && cacheState === 'missing',
      ),
      isOnline,
      isReadOnly,
      syncStatus,
      syncNotice,
      unlockError,
      cloudState: snapshotQuery.data,
      toggleTask,
      saveTask,
      deleteTask,
      saveProject,
      deleteProject,
      saveGoal,
      saveMilestone,
      saveLifeArea,
      saveLifeReview,
      linkRecords,
      unlinkRecord,
      saveInbox,
      deleteInbox,
      convertInboxToTask,
      convertInboxToNote,
      saveHabit,
      deleteHabit,
      toggleHabit,
      setHabitProgress,
      setHabitSkipped,
      pauseHabit,
      resumeHabit,
      saveRoutine,
      startRoutine,
      completeRoutineStep,
      deleteRoutineRun,
      deleteRoutine,
      saveNote,
      deleteNote,
      updateSettings,
      unlock,
      lock,
      syncNow,
      retryCloud,
      reminderPermission,
      remindersSupported: Platform.OS !== 'web',
      requestReminderPermission,
      openReminderSettings,
    }),
    [
      cacheState,
      data,
      convertInboxToNote,
      convertInboxToTask,
      deleteHabit,
      deleteInbox,
      deleteNote,
      deleteProject,
      saveGoal,
      saveMilestone,
      saveLifeArea,
      saveLifeReview,
      linkRecords,
      unlinkRecord,
      deleteRoutine,
      deleteRoutineRun,
      completeRoutineStep,
      deleteTask,
      isOnline,
      isReadOnly,
      isUnlocked,
      lock,
      retryCloud,
      saveNote,
      saveHabit,
      saveInbox,
      saveProject,
      saveRoutine,
      startRoutine,
      saveTask,
      snapshotQuery.data,
      snapshotQuery.isLoading,
      syncNow,
      syncNotice,
      syncStatus,
      toggleTask,
      toggleHabit,
      setHabitProgress,
      setHabitSkipped,
      pauseHabit,
      resumeHabit,
      unlock,
      unlockError,
      updateSettings,
      reminderPermission,
      requestReminderPermission,
      openReminderSettings,
    ],
  );

  return <PlannerContext.Provider value={contextValue}>{children}</PlannerContext.Provider>;
}

export function usePlanner(): PlannerContextValue {
  const context = useContext(PlannerContext);
  if (!context) throw new Error('usePlanner must be used within PlannerProvider.');
  return context;
}
