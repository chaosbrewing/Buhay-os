/** Device-only alarm metadata. Never put planner titles, text, keys or tokens here. */
export type AlarmSource = {
  kind: 'task' | 'habit' | 'routine' | 'event';
  id: string;
  calendarId?: string;
  occurrenceDate?: string;
};
export type DeviceAlarm = { id: string; source: AlarmSource; at: number };
export type AlarmPermissions = {
  canScheduleExactAlarms: boolean;
  canPostNotifications?: boolean;
  canUseFullScreenIntent?: boolean;
};
export type NativeAlarmInput = {
  id: string;
  timestamp: number;
  hour: number;
  minute: number;
  title: string;
  ios: {
    alertActionMode: 'default';
    stopIntentBehavior: 'recordOnly';
    secondaryButtonBehavior: 'none';
  };
  android: {
    alertActionMode: 'default';
    stopIntentBehavior: 'recordOnly';
    secondaryButtonBehavior: 'none';
    enforceVolume: false;
    fullScreen: false;
    maxRingDurationSeconds: number;
  };
};
export type AlarmNative = {
  getPermissionsAsync(): Promise<AlarmPermissions>;
  requestPermissionsAsync(): Promise<AlarmPermissions>;
  scheduleAlarmAsync(input: NativeAlarmInput): Promise<{ id: string }>;
  cancelAlarmAsync(id: string): Promise<boolean>;
  getScheduledAlarmsAsync(): Promise<Array<{ id: string }>>;
};
export type AlarmStorage = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};
type Manifest = { version: 1; owner: string | null; ids: string[] };
const MANIFEST_KEY = 'buhay.device-alarms.v1';
const recordKey = (id: string) => `buhay.alarm.${id}`;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_DEVICE_ALARMS = 24;

export function parseLocalAlarmTime(date: string, time: string, now = Date.now()): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new Error('Use YYYY-MM-DD and 24-hour HH:MM.');
  }
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const result = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (result.getFullYear() !== year || result.getMonth() !== month - 1 ||
      result.getDate() !== day || result.getHours() !== hour || result.getMinutes() !== minute) {
    throw new Error('That local time does not exist. Check the date or daylight-saving change.');
  }
  if (result.getTime() <= now) throw new Error('Choose a time in the future.');
  return result.getTime();
}

export function nativeAlarmInput(alarm: DeviceAlarm): NativeAlarmInput {
  const date = new Date(alarm.at);
  return {
    id: alarm.id, timestamp: alarm.at, hour: date.getHours(), minute: date.getMinutes(),
    title: 'HANAY alarm',
    ios: {
      alertActionMode: 'default', stopIntentBehavior: 'recordOnly', secondaryButtonBehavior: 'none',
    },
    android: {
      alertActionMode: 'default', stopIntentBehavior: 'recordOnly', secondaryButtonBehavior: 'none',
      // Do not fight the user's volume keys or assume full-screen permission / store eligibility.
      enforceVolume: false, fullScreen: false, maxRingDurationSeconds: 300,
    },
  };
}

function validSource(source: unknown): source is AlarmSource {
  if (!source || typeof source !== 'object') return false;
  const value = source as AlarmSource;
  return ['task', 'habit', 'routine', 'event'].includes(value.kind) &&
    typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 1024 &&
    (value.calendarId === undefined || (typeof value.calendarId === 'string' && value.calendarId.length <= 256)) &&
    (value.occurrenceDate === undefined || /^\d{4}-\d{2}-\d{2}$/.test(value.occurrenceDate));
}

/**
 * Serialized write-ahead journal: native scheduling is never attempted without a durable
 * cancellation ID. No cloud/snapshot schema or encryption format is changed.
 */
export function createDeviceAlarmService(
  storage: AlarmStorage,
  native: AlarmNative | null,
  makeId: () => string,
) {
  let desiredOwner: string | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation);
    queue = result.catch(() => undefined);
    return result;
  };
  const manifest = async (): Promise<Manifest> => {
    const raw = await storage.get(MANIFEST_KEY);
    if (!raw) return { version: 1, owner: null, ids: [] };
    const value = JSON.parse(raw) as Manifest;
    if (value.version !== 1 || !(value.owner === null || typeof value.owner === 'string') ||
        !Array.isArray(value.ids) || value.ids.length > MAX_DEVICE_ALARMS ||
        value.ids.some((id) => typeof id !== 'string' || !uuidPattern.test(id)) ||
        new Set(value.ids).size !== value.ids.length) {
      throw new Error('The device alarm journal is unreadable. It has not been overwritten.');
    }
    return value;
  };
  const writeManifest = (value: Manifest) => storage.set(MANIFEST_KEY, JSON.stringify(value));
  const checkOwner = (owner: string, state: Manifest) => {
    if (!owner || desiredOwner !== owner || state.owner !== owner) {
      throw new Error('The account changed. Reopen Alarms before trying again.');
    }
  };
  const readRecords = async (state: Manifest): Promise<DeviceAlarm[]> => {
    const result: DeviceAlarm[] = [];
    for (const id of state.ids) {
      const raw = await storage.get(recordKey(id));
      // A missing journal entry must not cause an OS alarm to be silently forgotten.
      if (!raw) throw new Error('An alarm record is missing. Cancel device alarms to recover.');
      const alarm = JSON.parse(raw) as DeviceAlarm;
      if (alarm.id !== id || !validSource(alarm.source) || !Number.isFinite(alarm.at)) {
        throw new Error('An alarm record is unreadable. Cancel device alarms to recover.');
      }
      result.push(alarm);
    }
    return result;
  };
  const cancelIds = async (ids: string[]) => {
    if (ids.length && !native) throw new Error('Use the native alarm build to cancel existing device alarms.');
    // False can mean an already fired/cancelled alarm. Thrown OS errors must block cleanup.
    for (const id of ids) {
      const cancelled = await native!.cancelAlarmAsync(id);
      if (!cancelled && (await native!.getScheduledAlarmsAsync()).some((alarm) => alarm.id === id)) {
        throw new Error('The device could not cancel an alarm. Its recovery record has been kept. Try again.');
      }
    }
  };
  return {
    activateAccount(owner: string | null) {
      // Invalidates an in-flight save immediately, before the queued cleanup.
      desiredOwner = owner;
      return enqueue(async () => {
        const state = await manifest();
        const scheduled = native ? await native.getScheduledAlarmsAsync() : [];
        if (state.owner !== owner) {
          await cancelIds([...new Set([...state.ids, ...scheduled.map((item) => item.id)])]);
          // Keep the journal intact until native cancellation has succeeded.
          await writeManifest({ version: 1, owner, ids: [] });
          for (const id of state.ids) await storage.remove(recordKey(id));
        } else {
          // This module is used exclusively for HANAY device alarms.
          await cancelIds(scheduled.filter((item) => !state.ids.includes(item.id)).map((item) => item.id));
        }
      });
    },
    list(owner: string) {
      return enqueue(async () => {
        const state = await manifest();
        checkOwner(owner, state);
        const records = await readRecords(state);
        const scheduled = native ? await native.getScheduledAlarmsAsync() : [];
        checkOwner(owner, state);
        return records.map((record) => ({
          ...record,
          scheduled: scheduled.some((item) => item.id === record.id),
        }));
      });
    },
    schedule(owner: string, source: AlarmSource, at: number, now = Date.now()) {
      return enqueue(async () => {
        if (!native) throw new Error('True alarms need a custom native build and iOS 26+ or Android.');
        const state = await manifest();
        checkOwner(owner, state);
        if (!validSource(source) || !Number.isFinite(at) || at <= now) {
          throw new Error('Choose an available item and a future alarm time.');
        }
        const permissions = await native.getPermissionsAsync();
        if (!permissions.canScheduleExactAlarms || permissions.canPostNotifications === false) {
          throw new Error('Alarm or notification permission is missing. Enable access and try again.');
        }
        const records = await readRecords(state);
        if (records.some((item) => item.at === at && JSON.stringify(item.source) === JSON.stringify(source))) {
          throw new Error('This item already has an alarm at that time.');
        }
        if (records.length >= MAX_DEVICE_ALARMS) throw new Error('Remove an old alarm first (24 per device).');
        const safeSource: AlarmSource = {
          kind: source.kind, id: source.id,
          ...(source.calendarId ? { calendarId: source.calendarId } : {}),
          ...(source.occurrenceDate ? { occurrenceDate: source.occurrenceDate } : {}),
        };
        const alarm: DeviceAlarm = { id: makeId(), source: safeSource, at };
        if (!uuidPattern.test(alarm.id)) throw new Error('Unable to create a safe alarm identifier.');
        checkOwner(owner, state);
        // Save the small metadata record before registering its ID; never schedule if either write fails.
        await storage.set(recordKey(alarm.id), JSON.stringify(alarm));
        await writeManifest({ ...state, ids: [...state.ids, alarm.id] });
        checkOwner(owner, state);
        const scheduled = await native.scheduleAlarmAsync(nativeAlarmInput(alarm));
        if (scheduled.id !== alarm.id) throw new Error('The device returned an unexpected alarm identifier.');
        // Account-switch cleanup is already queued and will cancel the journalled alarm.
        checkOwner(owner, state);
        return alarm;
      });
    },
    remove(owner: string, id: string) {
      return enqueue(async () => {
        const state = await manifest();
        checkOwner(owner, state);
        if (!state.ids.includes(id)) return;
        await cancelIds([id]);
        await writeManifest({ ...state, ids: state.ids.filter((item) => item !== id) });
        await storage.remove(recordKey(id));
      });
    },
    cancelAll(owner: string) {
      return enqueue(async () => {
        const state = await manifest();
        checkOwner(owner, state);
        const scheduled = native ? await native.getScheduledAlarmsAsync() : [];
        await cancelIds([...new Set([...state.ids, ...scheduled.map((item) => item.id)])]);
        await writeManifest({ ...state, ids: [] });
        for (const id of state.ids) await storage.remove(recordKey(id));
      });
    },
    /** Explicit user recovery only; never invoked automatically for an unreadable journal. */
    recoverJournal(owner: string | null) {
      return enqueue(async () => {
        if (desiredOwner !== owner) throw new Error('The account changed. Retry alarm cleanup.');
        if (!native) throw new Error('Use the native alarm build before resetting alarm records.');
        const raw = await storage.get(MANIFEST_KEY);
        let knownIds: string[] = [];
        try {
          const value = raw ? JSON.parse(raw) : {};
          if (Array.isArray(value.ids)) knownIds = value.ids.filter((id: unknown) => typeof id === 'string' && uuidPattern.test(id));
        } catch { /* Explicit recovery also accepts a malformed journal, after OS cancellation. */ }
        const scheduled = await native.getScheduledAlarmsAsync();
        await cancelIds([...new Set([...knownIds, ...scheduled.map((item) => item.id)])]);
        if (desiredOwner !== owner) throw new Error('The account changed. Retry alarm cleanup.');
        await writeManifest({ version: 1, owner, ids: [] });
        for (const id of knownIds) await storage.remove(recordKey(id));
      });
    },
  };
}
