import type { ActiveTimerState, AnnouncementKind } from '@/lib/timer-machine';

export type CountType = 'fixed' | 'perCard' | 'step';
export type DirectionMode = 'alternate' | 'fixed';
export type Direction = 'left' | 'right';
export type SettingsMode = 'shared' | 'individual';
export type StepKind = 'session' | 'pack' | 'pick' | 'last' | 'interval' | 'deck' | 'end';

export type CountSettings =
  | { type: 'fixed'; seconds: number }
  | { type: 'perCard'; seconds: number[] }
  | { type: 'step'; baseSeconds: number; decreaseSeconds: number };

export type PackRule = {
  cardCount: number;
  cardsPerPick: number;
  takeAll: boolean;
  takeCount: number;
  direction: Direction;
  count: CountSettings;
};

export type SharedPackRule = {
  cardCount: number;
  cardsPerPick: number;
  takeAll: boolean;
  takeCount: number;
  directionMode: DirectionMode;
  initialDirection: Direction;
  count: CountSettings;
};

export type SpeechSettings = {
  enabled: boolean;
  voice: string;
  rate: number;
  volume: number;
};

export type TimerCommonSettings = {
  name: string;
  packCount: number;
  packIntervals: number[];
  deckBuildSeconds: number;
  speech: SpeechSettings;
};

export type TimerSettings = {
  schemaVersion: 3;
  id: string;
  mode: SettingsMode;
  common: TimerCommonSettings;
  sharedRule: SharedPackRule;
  individualRules: PackRule[];
  individualInitialized: boolean;
};

export type RuntimeSettings = {
  id: string;
  mode: SettingsMode;
  common: TimerCommonSettings;
  packs: PackRule[];
};

export type DraftStep = {
  kind: StepKind;
  pack?: number;
  turn?: number;
  seconds: number;
  label: string;
  meta: string;
  cards?: number;
};

export type PickPhasePreview = {
  turn: number;
  label: string;
  seconds: number | null;
  finalCards: number | null;
};

export const DATA_VERSION = 3;
export const BACKUP_FORMAT = 'drafttimer-web-backup';
export const MAX_BACKUP_BYTES = 1024 * 1024;
export const defaultPerCard = [40, 40, 35, 30, 25, 25, 20, 20, 15, 10, 10, 5, 5, 5];
export const defaultSharedRule: SharedPackRule = {
  cardCount: 15,
  cardsPerPick: 1,
  takeAll: true,
  takeCount: 14,
  directionMode: 'alternate',
  initialDirection: 'left',
  count: { type: 'perCard', seconds: [...defaultPerCard] },
};
export const defaultTimer: TimerSettings = {
  schemaVersion: DATA_VERSION,
  id: 'standard-draft',
  mode: 'shared',
  common: {
    name: 'Standard Draft',
    packCount: 3,
    packIntervals: [60, 60],
    deckBuildSeconds: 1200,
    speech: { enabled: true, voice: '', rate: 1, volume: 1 },
  },
  sharedRule: defaultSharedRule,
  individualRules: [],
  individualInitialized: false,
};

export const numberRange = (start: number, end: number, step = 1) =>
  Array.from({ length: Math.floor((end - start) / step) + 1 }, (_, index) => start + index * step);

export const packCountOptions = numberRange(1, 10);
export const cardCountOptions = numberRange(2, 30);
export const cardsPerPickOptions = numberRange(1, 5);
export const deckBuildMinuteOptions = numberRange(0, 120);
export const secondOptions = [...numberRange(1, 120), ...numberRange(130, 600, 10), 900, 1200, 1800, 3600];
export const nonNegativeSecondOptions = [0, ...secondOptions];
export const stepDecreaseOptions = secondOptions.filter((value) => value <= 300);
export const speechRateOptions = numberRange(5, 20).map((value) => value / 10);
export const speechVolumeOptions = numberRange(0, 20).map((value) => value / 20);

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export function cloneCountSettings(count: CountSettings): CountSettings {
  if (count.type === 'perCard') return { type: 'perCard', seconds: [...count.seconds] };
  return { ...count };
}

export function clonePackRule(rule: PackRule): PackRule {
  return { ...rule, count: cloneCountSettings(rule.count) };
}

export function cloneCommonSettings(common: TimerCommonSettings): TimerCommonSettings {
  return { ...common, packIntervals: [...common.packIntervals], speech: { ...common.speech } };
}

export function cloneSharedRule(rule: SharedPackRule): SharedPackRule {
  return { ...rule, count: cloneCountSettings(rule.count) };
}

export function cloneTimer(settings: TimerSettings): TimerSettings {
  return {
    ...settings,
    common: cloneCommonSettings(settings.common),
    sharedRule: cloneSharedRule(settings.sharedRule),
    individualRules: settings.individualRules.map(clonePackRule),
  };
}

export function sharedDirectionForPack(rule: SharedPackRule, pack: number): Direction {
  if (rule.directionMode === 'fixed' || pack % 2 === 1) return rule.initialDirection;
  return rule.initialDirection === 'left' ? 'right' : 'left';
}

export function sharedPackRule(settings: TimerSettings, pack: number): PackRule {
  return {
    cardCount: settings.sharedRule.cardCount,
    cardsPerPick: settings.sharedRule.cardsPerPick,
    takeAll: settings.sharedRule.takeAll,
    takeCount: settings.sharedRule.takeCount,
    direction: sharedDirectionForPack(settings.sharedRule, pack),
    count: cloneCountSettings(settings.sharedRule.count),
  };
}

export function packRuleFor(settings: TimerSettings, pack: number): PackRule {
  if (settings.mode === 'individual') {
    return settings.individualRules[pack - 1] ?? sharedPackRule(settings, pack);
  }
  return sharedPackRule(settings, pack);
}

export function compileTimer(settings: TimerSettings): RuntimeSettings {
  return {
    id: settings.id,
    mode: settings.mode,
    common: cloneCommonSettings(settings.common),
    packs: Array.from({ length: settings.common.packCount }, (_, index) => clonePackRule(packRuleFor(settings, index + 1))),
  };
}

export function totalCardsToTake(rule: Pick<PackRule, 'cardCount' | 'takeAll' | 'takeCount'>) {
  if (rule.takeAll) return Math.max(1, rule.cardCount);
  return clamp(rule.takeCount, 1, Math.max(1, rule.cardCount - 1));
}

export function turnCount(rule: PackRule) {
  return Math.max(1, Math.ceil(totalCardsToTake(rule) / Math.max(1, rule.cardsPerPick)));
}

export function timedTurnCount(rule: PackRule) {
  return Math.max(0, turnCount(rule) - (rule.takeAll ? 1 : 0));
}

export function remainingCards(rule: PackRule, turn: number) {
  return Math.max(1, rule.cardCount - (turn - 1) * rule.cardsPerPick);
}

export function pickRange(rule: PackRule, turn: number) {
  const start = (turn - 1) * rule.cardsPerPick + 1;
  const end = Math.min(start + rule.cardsPerPick - 1, totalCardsToTake(rule));
  return start === end ? `${start}枚目` : `${start}〜${end}枚目`;
}

export function turnSeconds(rule: PackRule, turn: number) {
  if (rule.count.type === 'fixed') return Math.max(0, rule.count.seconds);
  if (rule.count.type === 'step') {
    return Math.max(0, rule.count.baseSeconds + rule.count.decreaseSeconds * (remainingCards(rule, turn) - 1));
  }
  return Math.max(0, rule.count.seconds[turn - 1] ?? defaultPerCard[turn - 1] ?? 10);
}

export function directionForPack(settings: RuntimeSettings, pack: number): Direction {
  return settings.packs[pack - 1]?.direction ?? 'left';
}

export function buildSteps(settings: RuntimeSettings): DraftStep[] {
  const result: DraftStep[] = [{ kind: 'session', seconds: 0, label: 'セッション開始', meta: '音声案内' }];
  for (let pack = 1; pack <= settings.common.packCount; pack += 1) {
    const rule = settings.packs[pack - 1];
    const turns = turnCount(rule);
    result.push({ kind: 'pack', pack, seconds: 0, label: `${pack}パック目を開始`, meta: 'パックを開封' });
    for (let turn = 1; turn <= turns; turn += 1) {
      const range = pickRange(rule, turn);
      const remaining = remainingCards(rule, turn);
      if (rule.takeAll && turn === turns) {
        const finalCards = Math.min(rule.cardsPerPick, remaining);
        result.push({ kind: 'last', pack, turn, seconds: 0, label: finalCards === 1 ? '最後のカード' : `最後の${finalCards}枚`, meta: `${range}・そのまま受け取る`, cards: finalCards });
      } else {
        const seconds = turnSeconds(rule, turn);
        result.push({ kind: 'pick', pack, turn, seconds, label: `${range}（${remaining}枚残）`, meta: `${seconds}秒` });
      }
    }
    if (pack < settings.common.packCount) {
      const seconds = Math.max(0, settings.common.packIntervals[pack - 1] ?? 0);
      if (seconds > 0) result.push({ kind: 'interval', pack, seconds, label: `パック${pack}後の休憩`, meta: `${seconds}秒` });
    }
  }
  if (settings.common.deckBuildSeconds > 0) {
    result.push({ kind: 'deck', seconds: settings.common.deckBuildSeconds, label: 'デッキ構築', meta: `${Math.ceil(settings.common.deckBuildSeconds / 60)}分` });
  }
  result.push({ kind: 'end', seconds: 0, label: 'ドラフト終了', meta: '音声案内' });
  return result;
}

export function buildPickPhasePreview(rule: PackRule): PickPhasePreview[] {
  const turns = turnCount(rule);
  return Array.from({ length: turns }, (_, index) => {
    const turn = index + 1;
    if (rule.takeAll && turn === turns) {
      return { turn, label: pickRange(rule, turn), seconds: null, finalCards: Math.min(rule.cardsPerPick, remainingCards(rule, turn)) };
    }
    return { turn, label: pickRange(rule, turn), seconds: turnSeconds(rule, turn), finalCards: null };
  });
}

export function countTypeLabel(count: CountSettings) {
  if (count.type === 'fixed') return '固定';
  if (count.type === 'step') return '階段';
  return '個別';
}

export function stepSpeechCues(step: DraftStep, settings: RuntimeSettings) {
  const rule = settings.packs[(step.pack ?? 1) - 1] ?? settings.packs[0];
  const direction = directionForPack(settings, step.pack ?? 1) === 'left' ? '左' : '右';
  if (step.kind === 'session') {
    const summary = settings.mode === 'individual'
      ? `一人当たり${settings.common.packCount}パック使用し、パックごとに個別の設定で進行します。`
      : `1パック${settings.packs[0].cardCount}枚、一人当たり${settings.common.packCount}パック使用します。`;
    return [`これより、ドラフトの音声案内を開始します。このドラフトでは、${summary}`];
  }
  if (step.kind === 'pack') return [`${step.pack}パック目のピックを開始します。パックを開封してください。`];
  if (step.kind === 'pick') return [`${pickRange(rule, step.turn ?? 1)}、制限時間${step.seconds}秒です、ピックアップ！`, `ドラフト！${direction}隣にまわしてください`];
  if (step.kind === 'last') {
    const lastLabel = step.cards && step.cards > 1 ? `最後の${step.cards}枚` : '最後のカード';
    return [`${lastLabel}はそのまま受け取ってください`];
  }
  if (step.kind === 'interval') return [`インターバルを開始します。制限時間${step.seconds}秒です。スタート！`, 'インターバル終了'];
  if (step.kind === 'deck') return [`デッキ構築を開始します。制限時間${Math.ceil(step.seconds / 60)}分です。スタート！`, 'デッキ構築の時間が終了しました'];
  return ['ドラフトのピックが終了しました', '以上で、音声案内を終了します。'];
}

export function stepFixedDelaySeconds(step: DraftStep) {
  return ['session', 'pack', 'pick', 'interval', 'deck'].includes(step.kind) ? 2 : 0;
}

export function formatTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

export function initialDisplaySeconds(settings: RuntimeSettings, step?: DraftStep) {
  if (!step) return 0;
  if (step.kind === 'session' || step.kind === 'pack') return turnSeconds(settings.packs[(step.pack ?? 1) - 1] ?? settings.packs[0], 1);
  return step.seconds;
}

export function announcementForStep(step: DraftStep): { kind: AnnouncementKind; label?: string } {
  if (step.kind === 'session') return { kind: 'sessionStart' };
  if (step.kind === 'pack') return { kind: 'packStart' };
  if (step.kind === 'pick') return { kind: 'pickStart' };
  if (step.kind === 'last') return { kind: 'lastPick', label: step.cards && step.cards > 1 ? `最後の${step.cards}枚` : '最後のカード' };
  if (step.kind === 'interval') return { kind: 'intervalStart' };
  if (step.kind === 'deck') return { kind: 'deckStart' };
  return { kind: 'sessionEnd' };
}

export function activeStateForStep(step: DraftStep, stepIndex: number, settings: RuntimeSettings, runId: number): ActiveTimerState {
  const announcement = announcementForStep(step);
  return {
    type: 'announcing',
    runId,
    stepIndex,
    remainingMs: initialDisplaySeconds(settings, step) * 1000,
    announcement: announcement.kind,
    announcementLabel: announcement.label,
  };
}

export function phaseGroupLabel(step: DraftStep) {
  if (step.pack) return `${step.pack}パック`;
  if (step.kind === 'session') return '開始';
  if (step.kind === 'deck') return '構築';
  return '終了';
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function normalizeCountSettings(raw: unknown, legacy: Record<string, unknown>, fallback: CountSettings, cardCount: number, cardsPerPick: number, takeAll: boolean, takeCount: number): CountSettings {
  const source = asRecord(raw);
  const typeValue = source.type ?? legacy.countType ?? fallback.type;
  const type: CountType = typeValue === 'fixed' || typeValue === 'step' ? typeValue : 'perCard';
  const totalTurns = Math.max(1, Math.ceil((takeAll ? cardCount : takeCount) / cardsPerPick));
  const normalizedTimedTurnCount = Math.max(0, totalTurns - (takeAll ? 1 : 0));
  if (type === 'fixed') {
    const fallbackSeconds = fallback.type === 'fixed' ? fallback.seconds : 40;
    return { type: 'fixed', seconds: clamp(Number(source.seconds ?? legacy.fixedSeconds ?? fallbackSeconds), 1, 3600) };
  }
  if (type === 'step') {
    const fallbackBase = fallback.type === 'step' ? fallback.baseSeconds : 0;
    const fallbackDecrease = fallback.type === 'step' ? fallback.decreaseSeconds : 3;
    return {
      type: 'step',
      baseSeconds: clamp(Number(source.baseSeconds ?? legacy.baseSeconds ?? fallbackBase), 0, 3600),
      decreaseSeconds: clamp(Number(source.decreaseSeconds ?? legacy.stepDecrease ?? fallbackDecrease), 1, 300),
    };
  }
  const values = Array.isArray(source.seconds)
    ? source.seconds
    : Array.isArray(legacy.perCardSeconds)
      ? legacy.perCardSeconds
      : fallback.type === 'perCard'
        ? fallback.seconds
        : defaultPerCard;
  return { type: 'perCard', seconds: Array.from({ length: normalizedTimedTurnCount }, (_, index) => clamp(Number(values[index] ?? defaultPerCard[index] ?? 10), 1, 3600)) };
}

function normalizePackRule(raw: unknown, fallback: PackRule): PackRule {
  const source = asRecord(raw);
  const cardCount = clamp(Number(source.cardCount ?? fallback.cardCount), 2, 30);
  const cardsPerPick = clamp(Number(source.cardsPerPick ?? fallback.cardsPerPick), 1, 5);
  const takeAll = typeof source.takeAll === 'boolean' ? source.takeAll : fallback.takeAll;
  const takeCount = clamp(Number(source.takeCount ?? fallback.takeCount ?? cardCount - 1), 1, cardCount - 1);
  return {
    cardCount,
    cardsPerPick,
    takeAll,
    takeCount,
    direction: source.direction === 'right' ? 'right' : source.direction === 'left' ? 'left' : fallback.direction,
    count: normalizeCountSettings(source.count, source, fallback.count, cardCount, cardsPerPick, takeAll, takeCount),
  };
}

function packRulesEqual(left: PackRule, right: PackRule) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function normalizeTimer(raw: unknown): TimerSettings {
  const source = asRecord(raw);
  const commonSource = asRecord(source.common);
  const speechSource = asRecord(commonSource.speech);
  const packCount = clamp(Number(commonSource.packCount ?? source.packCount ?? defaultTimer.common.packCount), 1, 10);
  const rawIntervals = Array.isArray(commonSource.packIntervals) ? commonSource.packIntervals : Array.isArray(source.packIntervals) ? source.packIntervals : defaultTimer.common.packIntervals;
  const common: TimerCommonSettings = {
    name: String(commonSource.name ?? source.name ?? defaultTimer.common.name).slice(0, 30) || '新しいタイマー',
    packCount,
    packIntervals: Array.from({ length: Math.max(0, packCount - 1) }, (_, index) => clamp(Number(rawIntervals[index] ?? 60), 0, 3600)),
    deckBuildSeconds: clamp(Number(commonSource.deckBuildSeconds ?? source.deckBuildSeconds ?? defaultTimer.common.deckBuildSeconds), 0, 7200),
    speech: {
      enabled: Boolean(speechSource.enabled ?? source.speechEnabled ?? defaultTimer.common.speech.enabled),
      voice: String(speechSource.voice ?? source.speechVoice ?? defaultTimer.common.speech.voice),
      rate: clamp(Number(speechSource.rate ?? source.speechRate ?? defaultTimer.common.speech.rate), 0.5, 2),
      volume: clamp(Number(speechSource.volume ?? source.speechVolume ?? defaultTimer.common.speech.volume), 0, 1),
    },
  };
  const sharedSource = asRecord(source.sharedRule);
  const sharedCardCount = clamp(Number(sharedSource.cardCount ?? source.cardCount ?? defaultSharedRule.cardCount), 2, 30);
  const sharedCardsPerPick = clamp(Number(sharedSource.cardsPerPick ?? source.cardsPerPick ?? defaultSharedRule.cardsPerPick), 1, 5);
  const sharedTakeAllSource = sharedSource.takeAll ?? source.takeAll;
  const sharedTakeAll = typeof sharedTakeAllSource === 'boolean' ? sharedTakeAllSource : defaultSharedRule.takeAll;
  const sharedTakeCount = clamp(Number(sharedSource.takeCount ?? source.takeCount ?? sharedCardCount - 1), 1, sharedCardCount - 1);
  const sharedRule: SharedPackRule = {
    cardCount: sharedCardCount,
    cardsPerPick: sharedCardsPerPick,
    takeAll: sharedTakeAll,
    takeCount: sharedTakeCount,
    directionMode: sharedSource.directionMode === 'fixed' || source.directionMode === 'fixed' ? 'fixed' : 'alternate',
    initialDirection: sharedSource.initialDirection === 'right' || source.initialDirection === 'right' ? 'right' : 'left',
    count: normalizeCountSettings(sharedSource.count, { ...source, ...sharedSource }, defaultSharedRule.count, sharedCardCount, sharedCardsPerPick, sharedTakeAll, sharedTakeCount),
  };
  const mode: SettingsMode = source.mode === 'individual' || source.settingsMode === 'individual' ? 'individual' : 'shared';
  const rawRules = Array.isArray(source.individualRules) ? source.individualRules : Array.isArray(source.packRules) ? source.packRules : [];
  const derivedRules = Array.from({ length: packCount }, (_, index) => sharedPackRule({ ...defaultTimer, common, sharedRule, mode: 'shared' }, index + 1));
  const migratedRules = Array.from({ length: packCount }, (_, index) => normalizePackRule(rawRules[index], derivedRules[index]));
  const legacyHasIndividualChanges = rawRules.length > 0 && migratedRules.some((rule, index) => !packRulesEqual(rule, derivedRules[index]));
  const individualInitialized = source.schemaVersion === DATA_VERSION ? Boolean(source.individualInitialized) : mode === 'individual' || legacyHasIndividualChanges;
  return {
    schemaVersion: DATA_VERSION,
    id: String(source.id || crypto.randomUUID()),
    mode,
    common,
    sharedRule,
    individualRules: individualInitialized ? migratedRules : [],
    individualInitialized,
  };
}

export function normalizeTimerCollection(rawTimers: unknown[]) {
  const usedIds = new Set<string>();
  return rawTimers.slice(0, 100).map((raw) => {
    const timer = normalizeTimer(raw);
    if (!usedIds.has(timer.id)) {
      usedIds.add(timer.id);
      return timer;
    }
    const next = { ...timer, id: crypto.randomUUID() };
    usedIds.add(next.id);
    return next;
  });
}

export function parseSettingsBackup(text: string) {
  const parsed = JSON.parse(text) as unknown;
  const source = asRecord(parsed);
  if (source.format !== undefined && source.format !== BACKUP_FORMAT) throw new Error('invalid-format');
  const dataVersion = Number(source.dataVersion ?? source.version ?? 1);
  if (!Number.isFinite(dataVersion) || dataVersion < 1) throw new Error('invalid-version');
  if (dataVersion > DATA_VERSION) throw new Error('unsupported-version');
  const rawTimers = Array.isArray(parsed) ? parsed : Array.isArray(source.timers) ? source.timers : [];
  if (!rawTimers.length) throw new Error('empty-backup');
  const timers = normalizeTimerCollection(rawTimers);
  if (!timers.length) throw new Error('empty-backup');
  const selectedId = String(source.selectedId ?? '');
  return { timers, selectedId: timers.some((timer) => timer.id === selectedId) ? selectedId : timers[0].id };
}

export function countSettingsForType(type: CountType, current: CountSettings, rule: PackRule): CountSettings {
  if (type === current.type) return cloneCountSettings(current);
  if (type === 'fixed') return { type: 'fixed', seconds: 40 };
  if (type === 'step') return { type: 'step', baseSeconds: 0, decreaseSeconds: 3 };
  return { type: 'perCard', seconds: Array.from({ length: timedTurnCount(rule) }, (_, index) => defaultPerCard[index] ?? 10) };
}
