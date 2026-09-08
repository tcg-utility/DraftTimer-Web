import { asRecord, DATA_VERSION, normalizeTimerCollection, type TimerSettings } from '@/lib/timer-domain';
import { isActiveTimerState, type ActiveTimerState, type AnnouncementKind, type TimerMachineState } from '@/lib/timer-machine';

export const SETTINGS_STORAGE_KEY = 'drafttimer:web:v1';
export const PROGRESS_STORAGE_KEY = 'drafttimer:web:progress:v1';
export const PROGRESS_VERSION = 1;

export type SettingsStore = {
  timers: TimerSettings[];
  selectedId: string;
};

type WithoutRunId<T> = T extends unknown ? Omit<T, 'runId'> : never;
export type StoredActiveState = WithoutRunId<ActiveTimerState>;

export type ProgressSnapshot = {
  version: 1;
  timerId: string;
  timerSignature: string;
  savedAt: string;
  active: StoredActiveState;
};

export type StorageWriteResult = { ok: true } | { ok: false; reason: 'unavailable' | 'quota' };

function storageOrDefault(storage?: Storage) {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function timerSignature(timer: TimerSettings) {
  return JSON.stringify(timer);
}

export function readSettings(storage?: Storage): SettingsStore | null {
  try {
    const target = storageOrDefault(storage);
    const saved = target?.getItem(SETTINGS_STORAGE_KEY);
    if (!saved) return null;
    const parsed = asRecord(JSON.parse(saved));
    const timers = Array.isArray(parsed.timers)
      ? normalizeTimerCollection(parsed.timers).filter((timer) => timer.common.name)
      : [];
    if (!timers.length) return null;
    const requestedId = String(parsed.selectedId ?? '');
    return {
      timers,
      selectedId: timers.some((timer) => timer.id === requestedId) ? requestedId : timers[0].id,
    };
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown, storage?: Storage): StorageWriteResult {
  try {
    const target = storageOrDefault(storage);
    if (!target) return { ok: false, reason: 'unavailable' };
    target.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
        ? 'quota'
        : 'unavailable',
    };
  }
}

export function writeSettings(value: SettingsStore, storage?: Storage) {
  return writeJson(SETTINGS_STORAGE_KEY, { dataVersion: DATA_VERSION, ...value }, storage);
}

function activeStateOf(machine: TimerMachineState): ActiveTimerState | null {
  if (machine.type === 'paused') return machine.suspended;
  return isActiveTimerState(machine) ? machine : null;
}

export function createProgressSnapshot(timer: TimerSettings, machine: TimerMachineState): ProgressSnapshot | null {
  const active = activeStateOf(machine);
  if (!active) return null;
  let stored: StoredActiveState;
  if (active.type === 'announcing') {
    stored = {
      type: active.type,
      stepIndex: active.stepIndex,
      remainingMs: active.remainingMs,
      announcement: active.announcement,
      announcementLabel: active.announcementLabel,
    };
  } else if (active.type === 'counting') {
    stored = { type: active.type, stepIndex: active.stepIndex, remainingMs: active.remainingMs, countdown: active.countdown };
  } else {
    stored = { type: active.type, stepIndex: active.stepIndex, remainingMs: active.remainingMs };
  }
  return {
    version: PROGRESS_VERSION,
    timerId: timer.id,
    timerSignature: timerSignature(timer),
    savedAt: new Date().toISOString(),
    active: stored,
  };
}

export function writeProgress(snapshot: ProgressSnapshot, storage?: Storage) {
  return writeJson(PROGRESS_STORAGE_KEY, snapshot, storage);
}

export function readProgress(timers: TimerSettings[], storage?: Storage): ProgressSnapshot | null {
  try {
    const target = storageOrDefault(storage);
    const saved = target?.getItem(PROGRESS_STORAGE_KEY);
    if (!saved) return null;
    const source = asRecord(JSON.parse(saved));
    if (source.version !== PROGRESS_VERSION) return null;
    const timerId = String(source.timerId ?? '');
    const timer = timers.find((item) => item.id === timerId);
    if (!timer || source.timerSignature !== timerSignature(timer)) return null;
    const active = asRecord(source.active);
    const type = active.type;
    if (type !== 'announcing' && type !== 'counting' && type !== 'passGuidance') return null;
    const stepIndex = Number(active.stepIndex);
    const remainingMs = Number(active.remainingMs);
    if (!Number.isInteger(stepIndex) || stepIndex < 0 || !Number.isFinite(remainingMs) || remainingMs < 0) return null;
    const common = { type, stepIndex, remainingMs };
    let parsedActive: StoredActiveState;
    if (type === 'announcing') {
      const allowed = ['sessionStart', 'packStart', 'pickStart', 'lastPick', 'intervalStart', 'intervalEnd', 'deckStart', 'deckEnd', 'sessionEnd'];
      if (!allowed.includes(String(active.announcement))) return null;
      parsedActive = {
        ...common,
        type,
        announcement: active.announcement as AnnouncementKind,
        announcementLabel: typeof active.announcementLabel === 'string' ? active.announcementLabel : undefined,
      } as StoredActiveState;
    } else if (type === 'counting') {
      if (active.countdown !== 'pick' && active.countdown !== 'interval' && active.countdown !== 'deck') return null;
      parsedActive = { ...common, type, countdown: active.countdown };
    } else {
      parsedActive = { ...common, type };
    }
    return {
      version: PROGRESS_VERSION,
      timerId,
      timerSignature: String(source.timerSignature),
      savedAt: String(source.savedAt ?? ''),
      active: parsedActive,
    };
  } catch {
    return null;
  }
}

export function clearProgress(storage?: Storage) {
  try {
    storageOrDefault(storage)?.removeItem(PROGRESS_STORAGE_KEY);
  } catch {
    // Private browsing and storage denial should not block timer operation.
  }
}
