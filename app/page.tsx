'use client';

import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  type ActiveTimerState,
  type AnnouncementKind,
  type CountdownKind,
  type TimerMachineEvent,
  type TimerMachineState,
  createIdleTimerState,
  isTimerPaused,
  isTimerRunning,
  timerRemainingMs,
  timerStatusLabel,
  timerStepIndex,
  transitionTimerState,
} from '@/lib/timer-machine';
import { SpeechController } from '@/lib/speech-controller';

type CountType = 'fixed' | 'perCard' | 'step';
type DirectionMode = 'alternate' | 'fixed';
type Direction = 'left' | 'right';
type SettingsMode = 'shared' | 'individual';
type StepKind = 'session' | 'pack' | 'pick' | 'last' | 'interval' | 'deck' | 'end';

export type CountSettings =
  | { type: 'fixed'; seconds: number }
  | { type: 'perCard'; seconds: number[] }
  | { type: 'step'; baseSeconds: number; decreaseSeconds: number };

export type PackRule = {
  cardCount: number;
  cardsPerPick: number;
  direction: Direction;
  count: CountSettings;
};

type SharedPackRule = {
  cardCount: number;
  cardsPerPick: number;
  directionMode: DirectionMode;
  initialDirection: Direction;
  count: CountSettings;
};

type SpeechSettings = {
  enabled: boolean;
  voice: string;
  rate: number;
  volume: number;
};

type TimerCommonSettings = {
  name: string;
  packCount: number;
  packIntervals: number[];
  deckBuildSeconds: number;
  speech: SpeechSettings;
};

export type TimerSettings = {
  schemaVersion: 2;
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

const STORAGE_KEY = 'drafttimer:web:v1';
const DATA_VERSION = 2;
const BACKUP_FORMAT = 'drafttimer-web-backup';
const MAX_BACKUP_BYTES = 1024 * 1024;
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const defaultPerCard = [40, 40, 35, 30, 25, 25, 20, 20, 15, 10, 10, 5, 5, 5];
const defaultSharedRule: SharedPackRule = {
  cardCount: 15,
  cardsPerPick: 1,
  directionMode: 'alternate',
  initialDirection: 'left',
  count: { type: 'perCard', seconds: [...defaultPerCard] },
};
const defaultTimer: TimerSettings = {
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

const numberRange = (start: number, end: number, step = 1) =>
  Array.from({ length: Math.floor((end - start) / step) + 1 }, (_, index) => start + index * step);

const packCountOptions = numberRange(1, 10);
const cardCountOptions = numberRange(2, 30);
const cardsPerPickOptions = numberRange(1, 5);
const deckBuildMinuteOptions = numberRange(0, 120);
const secondOptions = [...numberRange(1, 120), ...numberRange(130, 600, 10), 900, 1200, 1800, 3600];
const nonNegativeSecondOptions = [0, ...secondOptions];
const stepDecreaseOptions = secondOptions.filter((value) => value <= 300);
const speechRateOptions = numberRange(5, 20).map((value) => value / 10);
const speechVolumeOptions = numberRange(0, 20).map((value) => value / 20);
const monotonicNow = () => performance.now();

function NumberSelect({
  value,
  options,
  onChange,
  format = (option: number) => String(option),
}: {
  value: number;
  options: number[];
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  const choices = Array.from(new Set([...options, value])).sort((a, b) => a - b);
  return (
    <select value={value} onChange={(event) => onChange(Number(event.target.value))}>
      {choices.map((option) => <option value={option} key={option}>{format(option)}</option>)}
    </select>
  );
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

function clonePackRule(rule: PackRule): PackRule {
  return { ...rule, count: cloneCountSettings(rule.count) };
}

function cloneCountSettings(count: CountSettings): CountSettings {
  if (count.type === 'perCard') return { type: 'perCard', seconds: [...count.seconds] };
  return { ...count };
}

function sharedDirectionForPack(rule: SharedPackRule, pack: number): Direction {
  if (rule.directionMode === 'fixed' || pack % 2 === 1) return rule.initialDirection;
  return rule.initialDirection === 'left' ? 'right' : 'left';
}

function sharedPackRule(settings: TimerSettings, pack: number): PackRule {
  return {
    cardCount: settings.sharedRule.cardCount,
    cardsPerPick: settings.sharedRule.cardsPerPick,
    direction: sharedDirectionForPack(settings.sharedRule, pack),
    count: cloneCountSettings(settings.sharedRule.count),
  };
}

function packRuleFor(settings: TimerSettings, pack: number): PackRule {
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

function turnCount(rule: PackRule) {
  return Math.max(1, Math.ceil(Math.max(1, rule.cardCount) / Math.max(1, rule.cardsPerPick)));
}

function remainingCards(rule: PackRule, turn: number) {
  return Math.max(1, rule.cardCount - (turn - 1) * rule.cardsPerPick);
}

function pickRange(rule: PackRule, turn: number) {
  const start = (turn - 1) * rule.cardsPerPick + 1;
  const end = Math.min(start + rule.cardsPerPick - 1, rule.cardCount);
  return start === end ? `${start}枚目` : `${start}〜${end}枚目`;
}

export function turnSeconds(rule: PackRule, turn: number) {
  if (rule.count.type === 'fixed') return Math.max(0, rule.count.seconds);
  if (rule.count.type === 'step') {
    return Math.max(0, rule.count.baseSeconds + rule.count.decreaseSeconds * (remainingCards(rule, turn) - 1));
  }
  return Math.max(0, rule.count.seconds[turn - 1] ?? defaultPerCard[turn - 1] ?? 10);
}

function directionForPack(settings: RuntimeSettings, pack: number): Direction {
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
      if (turn === turns) {
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

type PickPhasePreview = {
  turn: number;
  label: string;
  seconds: number | null;
  finalCards: number | null;
};

export function buildPickPhasePreview(rule: PackRule): PickPhasePreview[] {
  const turns = turnCount(rule);
  return Array.from({ length: turns }, (_, index) => {
    const turn = index + 1;
    if (turn === turns) {
      return {
        turn,
        label: pickRange(rule, turn),
        seconds: null,
        finalCards: Math.min(rule.cardsPerPick, remainingCards(rule, turn)),
      };
    }
    return {
      turn,
      label: pickRange(rule, turn),
      seconds: turnSeconds(rule, turn),
      finalCards: null,
    };
  });
}

function countTypeLabel(count: CountSettings) {
  if (count.type === 'fixed') return '固定';
  if (count.type === 'step') return '階段';
  return '個別';
}

function stepSpeechCues(step: DraftStep, settings: RuntimeSettings) {
  const rule = settings.packs[(step.pack ?? 1) - 1] ?? settings.packs[0];
  const direction = directionForPack(settings, step.pack ?? 1) === 'left' ? '左' : '右';
  if (step.kind === 'session') {
    const summary = settings.mode === 'individual'
      ? `一人当たり${settings.common.packCount}パック使用し、パックごとに個別の設定で進行します。`
      : `1パック${settings.packs[0].cardCount}枚、一人当たり${settings.common.packCount}パック使用します。`;
    return [`これより、ドラフトの音声案内を開始します。このドラフトでは、${summary}`];
  }
  if (step.kind === 'pack') return [`${step.pack}パック目のピックを開始します。パックを開封してください。`];
  if (step.kind === 'pick') {
    return [
      `${pickRange(rule, step.turn ?? 1)}、制限時間${step.seconds}秒です、ピックアップ！`,
      `ドラフト！${direction}隣にまわしてください`,
    ];
  }
  if (step.kind === 'last') {
    const lastLabel = step.cards && step.cards > 1 ? `最後の${step.cards}枚` : '最後のカード';
    return [`${lastLabel}はそのまま受け取ってください`];
  }
  if (step.kind === 'interval') {
    return [`インターバルを開始します。制限時間${step.seconds}秒です。スタート！`, 'インターバル終了'];
  }
  if (step.kind === 'deck') {
    const minutes = Math.ceil(step.seconds / 60);
    return [`デッキ構築を開始します。制限時間${minutes}分です。スタート！`, 'デッキ構築の時間が終了しました'];
  }
  return ['ドラフトのピックが終了しました', '以上で、音声案内を終了します。'];
}

function stepFixedDelaySeconds(step: DraftStep) {
  return ['session', 'pack', 'pick', 'interval', 'deck'].includes(step.kind) ? 2 : 0;
}

function japaneseNumberMoraCount(value: number) {
  const digitMora = [2, 2, 2, 2, 2, 2, 2, 3, 2, 2];
  let number = Math.max(0, Math.floor(value));
  if (number === 0) return digitMora[0];
  let mora = 0;
  const thousands = Math.floor(number / 1000) % 10;
  if (thousands) mora += thousands === 1 ? 2 : thousands === 3 || thousands === 8 ? 4 : digitMora[thousands] + 2;
  const hundreds = Math.floor(number / 100) % 10;
  if (hundreds) mora += hundreds === 1 ? 3 : hundreds === 3 || hundreds === 6 || hundreds === 8 ? 4 : digitMora[hundreds] + 3;
  const tens = Math.floor(number / 10) % 10;
  if (tens) mora += tens === 1 ? 2 : digitMora[tens] + 2;
  number %= 10;
  if (number) mora += digitMora[number];
  return mora;
}

function estimateSpeechSeconds(text: string) {
  let mora = 0;
  let punctuationSeconds = 0;
  const tokens = text.match(/[0-9]+|./gu) ?? [];
  for (const token of tokens) {
    if (/^[0-9]+$/.test(token)) {
      mora += japaneseNumberMoraCount(Number(token));
    } else if (/\p{Script=Han}/u.test(token)) {
      mora += 1.8;
    } else if (/[ぁ-んァ-ヶー]/u.test(token)) {
      mora += 1;
    } else if (/[、,！!]/u.test(token)) {
      punctuationSeconds += 0.18;
    } else if (/[。？?]/u.test(token)) {
      punctuationSeconds += 0.32;
    } else if (!/\s/u.test(token)) {
      mora += 1;
    }
  }
  // 標準速度の日本語音声を基準に、発話開始のわずかな待ち時間も含める。
  return 0.2 + mora / 6.2 + punctuationSeconds;
}

export function estimateMinutes(settings: TimerSettings) {
  const runtime = compileTimer(settings);
  const totalSeconds = buildSteps(runtime).reduce((sum, step) => {
    const speechSeconds = stepSpeechCues(step, runtime).reduce((speech, text) => speech + estimateSpeechSeconds(text), 0);
    return sum + step.seconds + stepFixedDelaySeconds(step) + speechSeconds;
  }, 0);
  return (totalSeconds / 60).toFixed(1);
}

function formatTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function initialDisplaySeconds(settings: RuntimeSettings, step?: DraftStep) {
  if (!step) return 0;
  if (step.kind === 'session' || step.kind === 'pack') return turnSeconds(settings.packs[(step.pack ?? 1) - 1] ?? settings.packs[0], 1);
  return step.seconds;
}

function announcementForStep(step: DraftStep): { kind: AnnouncementKind; label?: string } {
  if (step.kind === 'session') return { kind: 'sessionStart' };
  if (step.kind === 'pack') return { kind: 'packStart' };
  if (step.kind === 'pick') return { kind: 'pickStart' };
  if (step.kind === 'last') {
    return {
      kind: 'lastPick',
      label: step.cards && step.cards > 1 ? `最後の${step.cards}枚` : '最後のカード',
    };
  }
  if (step.kind === 'interval') return { kind: 'intervalStart' };
  if (step.kind === 'deck') return { kind: 'deckStart' };
  return { kind: 'sessionEnd' };
}

function activeStateForStep(step: DraftStep, stepIndex: number, settings: RuntimeSettings, runId: number): ActiveTimerState {
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

function phaseGroupLabel(step: DraftStep) {
  if (step.pack) return `${step.pack}パック`;
  if (step.kind === 'session') return '開始';
  if (step.kind === 'deck') return '構築';
  return '終了';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function normalizeCountSettings(raw: unknown, legacy: Record<string, unknown>, fallback: CountSettings, cardCount: number, cardsPerPick: number): CountSettings {
  const source = asRecord(raw);
  const typeValue = source.type ?? legacy.countType ?? fallback.type;
  const type: CountType = typeValue === 'fixed' || typeValue === 'step' ? typeValue : 'perCard';
  const timedTurnCount = Math.max(1, Math.ceil(cardCount / cardsPerPick) - 1);
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
  return {
    type: 'perCard',
    seconds: Array.from({ length: timedTurnCount }, (_, index) => clamp(Number(values[index] ?? defaultPerCard[index] ?? 10), 1, 3600)),
  };
}

function normalizePackRule(raw: unknown, fallback: PackRule): PackRule {
  const source = asRecord(raw);
  const cardCount = clamp(Number(source.cardCount ?? fallback.cardCount), 2, 30);
  const cardsPerPick = clamp(Number(source.cardsPerPick ?? fallback.cardsPerPick), 1, 5);
  return {
    cardCount,
    cardsPerPick,
    direction: source.direction === 'right' ? 'right' : source.direction === 'left' ? 'left' : fallback.direction,
    count: normalizeCountSettings(source.count, source, fallback.count, cardCount, cardsPerPick),
  };
}

function cloneCommonSettings(common: TimerCommonSettings): TimerCommonSettings {
  return { ...common, packIntervals: [...common.packIntervals], speech: { ...common.speech } };
}

function cloneSharedRule(rule: SharedPackRule): SharedPackRule {
  return { ...rule, count: cloneCountSettings(rule.count) };
}

function packRulesEqual(left: PackRule, right: PackRule) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function normalizeTimer(raw: unknown): TimerSettings {
  const source = asRecord(raw);
  const commonSource = asRecord(source.common);
  const speechSource = asRecord(commonSource.speech);
  const packCount = clamp(Number(commonSource.packCount ?? source.packCount ?? defaultTimer.common.packCount), 1, 10);
  const rawIntervals = Array.isArray(commonSource.packIntervals)
    ? commonSource.packIntervals
    : Array.isArray(source.packIntervals)
      ? source.packIntervals
      : defaultTimer.common.packIntervals;
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
  const sharedRule: SharedPackRule = {
    cardCount: sharedCardCount,
    cardsPerPick: sharedCardsPerPick,
    directionMode: sharedSource.directionMode === 'fixed' || source.directionMode === 'fixed' ? 'fixed' : 'alternate',
    initialDirection: sharedSource.initialDirection === 'right' || source.initialDirection === 'right' ? 'right' : 'left',
    count: normalizeCountSettings(sharedSource.count, { ...source, ...sharedSource }, defaultSharedRule.count, sharedCardCount, sharedCardsPerPick),
  };
  const mode: SettingsMode = source.mode === 'individual' || source.settingsMode === 'individual' ? 'individual' : 'shared';
  const rawRules = Array.isArray(source.individualRules)
    ? source.individualRules
    : Array.isArray(source.packRules)
      ? source.packRules
      : [];
  const derivedRules = Array.from({ length: packCount }, (_, index) => {
    const base: TimerSettings = { ...defaultTimer, common, sharedRule, mode: 'shared' };
    return sharedPackRule(base, index + 1);
  });
  const migratedRules = Array.from({ length: packCount }, (_, index) => normalizePackRule(rawRules[index], derivedRules[index]));
  const legacyHasIndividualChanges = rawRules.length > 0 && migratedRules.some((rule, index) => !packRulesEqual(rule, derivedRules[index]));
  const individualInitialized = source.schemaVersion === DATA_VERSION
    ? Boolean(source.individualInitialized)
    : mode === 'individual' || legacyHasIndividualChanges;
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

function cloneTimer(settings: TimerSettings): TimerSettings {
  return {
    ...settings,
    common: cloneCommonSettings(settings.common),
    sharedRule: cloneSharedRule(settings.sharedRule),
    individualRules: settings.individualRules.map(clonePackRule),
  };
}

function normalizeTimerCollection(rawTimers: unknown[]) {
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

function parseSettingsBackup(text: string) {
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
  return {
    timers,
    selectedId: timers.some((timer) => timer.id === selectedId) ? selectedId : timers[0].id,
  };
}

function countSettingsForType(type: CountType, current: CountSettings, rule: PackRule): CountSettings {
  if (type === current.type) return cloneCountSettings(current);
  if (type === 'fixed') return { type: 'fixed', seconds: 40 };
  if (type === 'step') return { type: 'step', baseSeconds: 0, decreaseSeconds: 3 };
  return {
    type: 'perCard',
    seconds: Array.from({ length: Math.max(1, turnCount(rule) - 1) }, (_, index) => defaultPerCard[index] ?? 10),
  };
}

function PickPhasePreviewList({ rule }: { rule: PackRule }) {
  const phases = buildPickPhasePreview(rule);
  return (
    <section className="pick-preview" aria-label="ピック時間プレビュー">
      <div className="pick-preview-heading">
        <strong>ピック時間プレビュー</strong>
        <span>実際の進行順</span>
      </div>
      <ol>
        {phases.map((phase) => (
          <li className={phase.finalCards !== null ? 'final' : ''} key={phase.turn}>
            <span>{phase.finalCards === 1 ? '最後のカード' : phase.finalCards !== null ? `最後の${phase.finalCards}枚` : `${phase.turn}ピック目`}</span>
            <small>{phase.label}</small>
            <strong>{phase.seconds === null ? 'カウントなし' : `${phase.seconds}秒`}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}

function CountSettingsFields({ rule, onChange }: { rule: PackRule; onChange: (count: CountSettings) => void }) {
  const timedTurns = Math.max(0, turnCount(rule) - 1);
  const perCardSeconds = rule.count.type === 'perCard' ? rule.count.seconds : [];
  return <>
    <div className="segmented three" role="group" aria-label="カウント方式">
      <button type="button" className={rule.count.type === 'fixed' ? 'selected' : ''} aria-pressed={rule.count.type === 'fixed'} onClick={() => onChange(countSettingsForType('fixed', rule.count, rule))}>固定</button>
      <button type="button" className={rule.count.type === 'perCard' ? 'selected' : ''} aria-pressed={rule.count.type === 'perCard'} onClick={() => onChange(countSettingsForType('perCard', rule.count, rule))}>個別</button>
      <button type="button" className={rule.count.type === 'step' ? 'selected' : ''} aria-pressed={rule.count.type === 'step'} onClick={() => onChange(countSettingsForType('step', rule.count, rule))}>階段</button>
    </div>
    {rule.count.type === 'fixed' && <label className="field full"><span>1ピックの時間</span><NumberSelect value={rule.count.seconds} options={secondOptions} onChange={(value) => onChange({ type: 'fixed', seconds: value })} format={(value) => `${value}秒`} /></label>}
    {rule.count.type === 'step' && <>
      <div className="field-row">
        <label className="field"><span>下駄秒数</span><NumberSelect value={rule.count.baseSeconds} options={nonNegativeSecondOptions} onChange={(value) => onChange({ type: 'step', baseSeconds: value, decreaseSeconds: rule.count.type === 'step' ? rule.count.decreaseSeconds : 3 })} format={(value) => `${value}秒`} /></label>
        <label className="field"><span>1枚ごとの減少量</span><NumberSelect value={rule.count.decreaseSeconds} options={stepDecreaseOptions} onChange={(value) => onChange({ type: 'step', baseSeconds: rule.count.type === 'step' ? rule.count.baseSeconds : 0, decreaseSeconds: value })} format={(value) => `${value}秒`} /></label>
      </div>
      <p className="step-note">※ 計算方法：1ピックの時間（秒）＝1枚ごとの減少量 ×（ピック開始時のパック残枚数 − 1）＋下駄秒数</p>
    </>}
    {rule.count.type === 'perCard' && (timedTurns > 0
      ? <div className="per-card-grid">{Array.from({ length: timedTurns }, (_, index) => <label className="mini-field" key={index}><span>{pickRange(rule, index + 1)}</span><NumberSelect value={turnSeconds(rule, index + 1)} options={secondOptions} onChange={(value) => { const next = Array.from({ length: Math.max(perCardSeconds.length, index + 1) }, (_, itemIndex) => perCardSeconds[itemIndex] ?? defaultPerCard[itemIndex] ?? 10); next[index] = value; onChange({ type: 'perCard', seconds: next }); }} format={(value) => `${value}秒`} /></label>)}</div>
      : <p className="preview-line">カウント対象のピックはありません</p>)}
    <PickPhasePreviewList rule={rule} />
  </>;
}

export default function Home() {
  const [timers, setTimers] = useState<TimerSettings[]>([defaultTimer]);
  const [selectedId, setSelectedId] = useState(defaultTimer.id);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editorTimers, setEditorTimers] = useState<TimerSettings[]>([cloneTimer(defaultTimer)]);
  const [draftId, setDraftId] = useState(defaultTimer.id);
  const [editingPackIndex, setEditingPackIndex] = useState(0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [backupMessage, setBackupMessage] = useState('');
  const [ready, setReady] = useState(false);
  const [machine, setMachine] = useState<TimerMachineState>(() =>
    createIdleTimerState(turnSeconds(sharedPackRule(defaultTimer, 1), 1) * 1000),
  );

  const current = timers.find((timer) => timer.id === selectedId) ?? timers[0] ?? defaultTimer;
  const currentRuntime = useMemo(() => compileTimer(current), [current]);
  const steps = useMemo(() => buildSteps(currentRuntime), [currentRuntime]);
  const draft = editorTimers.find((timer) => timer.id === draftId) ?? editorTimers[0] ?? defaultTimer;
  const currentIndex = timerStepIndex(machine);
  const remainingMs = timerRemainingMs(machine);
  const isActive = isTimerRunning(machine);
  const isPaused = isTimerPaused(machine);
  const status = timerStatusLabel(machine);
  const currentStep = steps[Math.min(currentIndex, steps.length - 1)] ?? steps[0];
  const maxSeconds = Math.max(1, currentStep?.seconds ?? 1);
  const progress = Math.max(0, Math.min(100, (remainingMs / (maxSeconds * 1000)) * 100));

  const machineRef = useRef(machine);
  const runTokenRef = useRef(0);
  const speechControllerRef = useRef<SpeechController | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

  const sendMachine = (event: TimerMachineEvent) => {
    const next = transitionTimerState(machineRef.current, event);
    machineRef.current = next;
    setMachine(next);
    return next;
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { timers?: unknown[]; selectedId?: string; dataVersion?: number };
        const restored = parsed.timers ? normalizeTimerCollection(parsed.timers).filter((timer) => timer.common.name) : [];
        if (restored.length) {
          // localStorage is only available after the client mounts.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setTimers(restored);
          const nextId = restored.some((timer) => timer.id === parsed.selectedId) ? parsed.selectedId! : restored[0].id;
          setSelectedId(nextId);
          const selected = restored.find((timer) => timer.id === nextId) ?? restored[0];
          setEditorTimers(restored.map(cloneTimer));
          setDraftId(nextId);
          const runtime = compileTimer(selected);
          const runId = runTokenRef.current + 1;
          runTokenRef.current = runId;
          sendMachine({
            type: 'RESET',
            runId,
            stepIndex: 0,
            remainingMs: initialDisplaySeconds(runtime, buildSteps(runtime)[0]) * 1000,
          });
        }
      }
    } catch {
      // 壊れた端末内データは初期値で安全に復旧する。
    }
    setReady(true);
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register(`${BASE_PATH}/sw.js`).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ dataVersion: DATA_VERSION, timers, selectedId }));
  }, [ready, selectedId, timers]);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
  }, []);

  useEffect(() => () => speechControllerRef.current?.stop(), []);

  useEffect(() => {
    if (!isActive || isPaused) {
      wakeLockRef.current?.release().catch(() => undefined);
      wakeLockRef.current = null;
      return;
    }
    const requestWakeLock = async () => {
      try {
        const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
        if (wakeLock) wakeLockRef.current = await wakeLock.request('screen');
      } catch {
        // Wake Lock非対応端末では通常のタイマーとして動作を継続する。
      }
    };
    requestWakeLock();
    return () => {
      wakeLockRef.current?.release().catch(() => undefined);
      wakeLockRef.current = null;
    };
  }, [isActive, isPaused]);

  const speechController = () => {
    if (!speechControllerRef.current) speechControllerRef.current = new SpeechController();
    return speechControllerRef.current;
  };

  const stopSpeech = () => speechControllerRef.current?.stop();

  const halt = () => {
    const runId = runTokenRef.current + 1;
    runTokenRef.current = runId;
    stopSpeech();
    return runId;
  };

  const resetProgressFor = (settings: TimerSettings) => {
    const runId = halt();
    const runtime = compileTimer(settings);
    const sequence = buildSteps(runtime);
    sendMachine({
      type: 'RESET',
      runId,
      stepIndex: 0,
      remainingMs: initialDisplaySeconds(runtime, sequence[0]) * 1000,
    });
  };

  const waitForResume = async (runId: number) => {
    while (runTokenRef.current === runId && isTimerPaused(machineRef.current)) {
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    if (runTokenRef.current !== runId || !isTimerRunning(machineRef.current)) throw new Error('cancelled');
  };

  const assertCurrentRun = (runId: number) => {
    if (runTokenRef.current !== runId || !isTimerRunning(machineRef.current)) throw new Error('cancelled');
  };

  const sleepPausable = async (milliseconds: number, runId: number) => {
    let left = milliseconds;
    while (left > 0) {
      await waitForResume(runId);
      const startedAt = monotonicNow();
      await new Promise((resolve) => setTimeout(resolve, Math.min(80, left)));
      assertCurrentRun(runId);
      if (!isTimerPaused(machineRef.current)) left -= monotonicNow() - startedAt;
    }
  };

  const speakPausable = async (text: string, settings: RuntimeSettings, runId: number) => {
    if (!settings.common.speech.enabled) return;
    while (runTokenRef.current === runId && isTimerRunning(machineRef.current)) {
      await waitForResume(runId);
      const result = await speechController().speak(text, settings.common.speech);
      if (result === 'ended') return;
      if (!isTimerPaused(machineRef.current)) throw new Error('cancelled');
    }
  };

  const announceNumber = (text: string, settings: RuntimeSettings) => {
    speechController().announce(text, settings.common.speech);
  };

  const enterAnnouncement = (
    step: DraftStep,
    stepIndex: number,
    settings: RuntimeSettings,
    runId: number,
    announcement: AnnouncementKind,
    announcementLabel?: string,
  ) => {
    sendMachine({
      type: 'ENTER_ANNOUNCEMENT',
      runId,
      stepIndex,
      remainingMs: initialDisplaySeconds(settings, step) * 1000,
      announcement,
      announcementLabel,
    });
  };

  const enterCountdown = (
    step: DraftStep,
    stepIndex: number,
    runId: number,
    countdownKind: CountdownKind,
  ) => {
    sendMachine({
      type: 'ENTER_COUNTDOWN',
      runId,
      stepIndex,
      remainingMs: step.seconds * 1000,
      countdown: countdownKind,
    });
  };

  const countdown = async (seconds: number, settings: RuntimeSettings, runId: number) => {
    let left = seconds * 1000;
    const startWhole = Math.ceil(seconds);
    let lastSpoken: number | null = null;
    while (left > 0) {
      await waitForResume(runId);
      const startedAt = monotonicNow();
      await new Promise((resolve) => setTimeout(resolve, 50));
      assertCurrentRun(runId);
      if (!isTimerPaused(machineRef.current)) left = Math.max(0, left - (monotonicNow() - startedAt));
      sendMachine({ type: 'TICK', runId, remainingMs: left });
      const whole = Math.ceil(left / 1000);
      if (whole !== lastSpoken) {
        const isInitialSecond = lastSpoken === null && whole === startWhole;
        lastSpoken = whole;
        if (!isInitialSecond) {
          if (whole > 30 && whole % 60 === 0) {
            announceNumber(`残り${whole / 60}分です`, settings);
          } else if (whole > 0 && whole <= 30 && whole % 10 === 0) {
            announceNumber(`残り${whole}秒です`, settings);
          }
        }
        if (whole === 3 || whole === 2 || whole === 1) announceNumber(String(whole), settings);
      }
    }
    sendMachine({ type: 'TICK', runId, remainingMs: 0 });
  };

  const executeStep = async (
    step: DraftStep,
    stepIndex: number,
    settings: RuntimeSettings,
    runId: number,
  ) => {
    const cues = stepSpeechCues(step, settings);
    const fixedDelayMs = stepFixedDelaySeconds(step) * 1000;
    if (step.kind === 'session') {
      enterAnnouncement(step, stepIndex, settings, runId, 'sessionStart');
      await speakPausable(cues[0], settings, runId);
      await sleepPausable(fixedDelayMs, runId);
    } else if (step.kind === 'pack') {
      enterAnnouncement(step, stepIndex, settings, runId, 'packStart');
      await speakPausable(cues[0], settings, runId);
      await sleepPausable(fixedDelayMs, runId);
    } else if (step.kind === 'pick') {
      enterAnnouncement(step, stepIndex, settings, runId, 'pickStart');
      await speakPausable(cues[0], settings, runId);
      enterCountdown(step, stepIndex, runId, 'pick');
      await countdown(step.seconds, settings, runId);
      stopSpeech();
      sendMachine({ type: 'ENTER_PASS_GUIDANCE', runId, stepIndex, remainingMs: 0 });
      await speakPausable(cues[1], settings, runId);
      await sleepPausable(fixedDelayMs, runId);
    } else if (step.kind === 'last') {
      const lastLabel = step.cards && step.cards > 1 ? `最後の${step.cards}枚` : '最後のカード';
      enterAnnouncement(step, stepIndex, settings, runId, 'lastPick', lastLabel);
      await speakPausable(cues[0], settings, runId);
    } else if (step.kind === 'interval') {
      enterAnnouncement(step, stepIndex, settings, runId, 'intervalStart');
      await speakPausable(cues[0], settings, runId);
      enterCountdown(step, stepIndex, runId, 'interval');
      await countdown(step.seconds, settings, runId);
      stopSpeech();
      enterAnnouncement(step, stepIndex, settings, runId, 'intervalEnd');
      await speakPausable(cues[1], settings, runId);
      await sleepPausable(fixedDelayMs, runId);
    } else if (step.kind === 'deck') {
      enterAnnouncement(step, stepIndex, settings, runId, 'deckStart');
      await speakPausable(cues[0], settings, runId);
      enterCountdown(step, stepIndex, runId, 'deck');
      await countdown(step.seconds, settings, runId);
      stopSpeech();
      enterAnnouncement(step, stepIndex, settings, runId, 'deckEnd');
      await speakPausable(cues[1], settings, runId);
      await sleepPausable(fixedDelayMs, runId);
    } else {
      enterAnnouncement(step, stepIndex, settings, runId, 'sessionEnd');
      await speakPausable(cues[0], settings, runId);
      await speakPausable(cues[1], settings, runId);
    }
  };

  const beginRun = (requestedIndex = timerStepIndex(machineRef.current), startPaused = false) => {
    const settingsSnapshot = compileTimer(cloneTimer(current));
    const sequence = buildSteps(settingsSnapshot);
    const startIndex = clamp(requestedIndex, 0, Math.max(0, sequence.length - 1));
    const runId = runTokenRef.current + 1;
    runTokenRef.current = runId;
    stopSpeech();
    sendMachine({
      type: 'START_RUN',
      runId,
      initial: activeStateForStep(sequence[startIndex], startIndex, settingsSnapshot, runId),
      paused: startPaused,
    });

    void (async () => {
      try {
        for (let index = startIndex; index < sequence.length; index += 1) {
          await waitForResume(runId);
          await executeStep(sequence[index], index, settingsSnapshot, runId);
        }
        if (runTokenRef.current === runId) {
          sendMachine({
            type: 'COMPLETE',
            runId,
            stepIndex: sequence.length - 1,
            remainingMs: 0,
          });
        }
      } catch {
        // リセット、設定変更、フェイズ移動による古い実行の中断は正常な状態遷移。
      }
    })();
  };

  const pauseTimer = () => {
    if (!isTimerRunning(machineRef.current) || isTimerPaused(machineRef.current)) return;
    sendMachine({ type: 'PAUSE' });
    stopSpeech();
  };

  useEffect(() => {
    const pauseWhenHidden = () => {
      if (document.hidden && isTimerRunning(machineRef.current) && !isTimerPaused(machineRef.current)) pauseTimer();
    };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden);
  });

  const togglePlay = () => {
    const currentMachine = machineRef.current;
    if (isTimerRunning(currentMachine) && !isTimerPaused(currentMachine)) {
      pauseTimer();
      return;
    }
    if (isTimerPaused(currentMachine)) {
      sendMachine({ type: 'RESUME' });
      return;
    }
    beginRun(currentMachine.type === 'completed' ? 0 : timerStepIndex(currentMachine));
  };

  const resetTimer = () => {
    resetProgressFor(current);
  };

  const jumpTo = (index: number) => {
    const currentMachine = machineRef.current;
    const restart = isTimerRunning(currentMachine);
    const stayPaused = isTimerPaused(currentMachine);
    const bounded = clamp(index, 0, Math.max(0, steps.length - 1));
    const runId = halt();
    if (restart) {
      beginRun(bounded, stayPaused);
      return;
    }
    sendMachine({
      type: 'RESET',
      runId,
      stepIndex: bounded,
      remainingMs: initialDisplaySeconds(currentRuntime, steps[bounded]) * 1000,
    });
  };

  const openSettings = () => {
    if (isTimerRunning(machineRef.current) && !isTimerPaused(machineRef.current)) pauseTimer();
    setEditorTimers(timers.map(cloneTimer));
    setDraftId(current.id);
    setEditingPackIndex(0);
    setBackupMessage('');
    setSettingsOpen(true);
  };

  const saveSettings = () => {
    const normalizedTimers = editorTimers.map(normalizeTimer);
    const selected = normalizedTimers.find((timer) => timer.id === draftId) ?? normalizedTimers[0];
    if (!selected) return;
    setTimers(normalizedTimers);
    setSelectedId(selected.id);
    resetProgressFor(selected);
    setSettingsOpen(false);
  };

  const selectTimer = (id: string) => {
    const next = timers.find((timer) => timer.id === id);
    if (!next) return;
    setSelectedId(id);
    setEditingPackIndex(0);
    resetProgressFor(next);
  };

  const selectEditorTimer = (id: string) => {
    if (!editorTimers.some((timer) => timer.id === id)) return;
    setDraftId(id);
    setEditingPackIndex(0);
  };

  const addTimer = () => {
    const copy = normalizeTimer({
      ...cloneTimer(defaultTimer),
      id: crypto.randomUUID(),
      common: { ...cloneCommonSettings(defaultTimer.common), name: `新しいタイマー ${editorTimers.length + 1}` },
    });
    setEditorTimers((items) => [...items, copy]);
    setDraftId(copy.id);
    setEditingPackIndex(0);
  };

  const copyTimer = () => {
    const copy = normalizeTimer({
      ...cloneTimer(draft),
      id: crypto.randomUUID(),
      common: { ...cloneCommonSettings(draft.common), name: `${draft.common.name} のコピー`.slice(0, 30) },
    });
    setEditorTimers((items) => [...items, copy]);
    setDraftId(copy.id);
    setEditingPackIndex(0);
  };

  const deleteTimer = () => {
    if (editorTimers.length <= 1 || !window.confirm(`「${draft.common.name}」を削除しますか？`)) return;
    const next = editorTimers.filter((timer) => timer.id !== draft.id);
    const selected = next[0];
    setEditorTimers(next);
    setDraftId(selected.id);
    setEditingPackIndex(0);
  };

  const updateDraftState = (updater: (previous: TimerSettings) => TimerSettings) => {
    setEditorTimers((items) => items.map((item) => item.id === draftId ? updater(cloneTimer(item)) : item));
  };

  const updateCommon = <K extends keyof TimerCommonSettings>(key: K, value: TimerCommonSettings[K]) =>
    updateDraftState((previous) => ({ ...previous, common: { ...previous.common, [key]: value } }));

  const updateSpeech = <K extends keyof SpeechSettings>(key: K, value: SpeechSettings[K]) =>
    updateDraftState((previous) => ({
      ...previous,
      common: { ...previous.common, speech: { ...previous.common.speech, [key]: value } },
    }));

  const updateSharedRule = (patch: Partial<Omit<SharedPackRule, 'count'>> & { count?: CountSettings }) =>
    updateDraftState((previous) => ({
      ...previous,
      sharedRule: {
        ...previous.sharedRule,
        ...patch,
        count: patch.count ? cloneCountSettings(patch.count) : previous.sharedRule.count,
      },
    }));

  const updatePackCount = (value: number) => {
    const packCount = clamp(value, 1, 10);
    updateDraftState((previous) => {
      const packIntervals = Array.from({ length: Math.max(0, packCount - 1) }, (_, index) => previous.common.packIntervals[index] ?? 60);
      const individualRules = previous.individualRules.map(clonePackRule);
      if (previous.individualInitialized) {
        for (let index = individualRules.length; index < packCount; index += 1) {
          const prior = individualRules[index - 1];
          if (prior) {
            individualRules.push({ ...clonePackRule(prior), direction: prior.direction === 'left' ? 'right' : 'left' });
          } else {
            individualRules.push(sharedPackRule(previous, index + 1));
          }
        }
      }
      return { ...previous, common: { ...previous.common, packCount, packIntervals }, individualRules };
    });
    setEditingPackIndex((previous) => Math.min(previous, packCount - 1));
  };

  const updatePackRule = (patch: Partial<PackRule>) => {
    updateDraftState((previous) => {
      const rules = Array.from({ length: previous.common.packCount }, (_, index) => clonePackRule(previous.individualRules[index] ?? sharedPackRule(previous, index + 1)));
      rules[editingPackIndex] = {
        ...rules[editingPackIndex],
        ...patch,
        count: patch.count ? cloneCountSettings(patch.count) : rules[editingPackIndex].count,
      };
      return { ...previous, individualRules: rules, individualInitialized: true };
    });
  };

  const selectSettingsMode = (mode: SettingsMode) => {
    updateDraftState((previous) => {
      if (mode !== 'individual' || previous.individualInitialized) return { ...previous, mode };
      return {
        ...previous,
        mode,
        individualInitialized: true,
        individualRules: Array.from({ length: previous.common.packCount }, (_, index) => sharedPackRule(previous, index + 1)),
      };
    });
    setEditingPackIndex(0);
  };

  const applySharedRuleToAllPacks = () => {
    updateDraftState((previous) => ({
      ...previous,
      individualInitialized: true,
      individualRules: Array.from({ length: previous.common.packCount }, (_, index) => sharedPackRule(previous, index + 1)),
    }));
  };

  const copyPreviousPackRule = () => {
    if (editingPackIndex <= 0) return;
    updateDraftState((previous) => {
      const rules = Array.from({ length: previous.common.packCount }, (_, index) => clonePackRule(previous.individualRules[index] ?? sharedPackRule(previous, index + 1)));
      rules[editingPackIndex] = clonePackRule(rules[editingPackIndex - 1]);
      return { ...previous, individualRules: rules, individualInitialized: true };
    });
  };

  const applyCurrentPackRuleToFollowing = () => {
    if (editingPackIndex >= draft.common.packCount - 1) return;
    updateDraftState((previous) => {
      const rules = Array.from({ length: previous.common.packCount }, (_, index) => clonePackRule(previous.individualRules[index] ?? sharedPackRule(previous, index + 1)));
      const source = clonePackRule(rules[editingPackIndex]);
      for (let index = editingPackIndex + 1; index < rules.length; index += 1) rules[index] = clonePackRule(source);
      return { ...previous, individualRules: rules, individualInitialized: true };
    });
  };

  const applyCurrentPackRuleToAll = () => {
    updateDraftState((previous) => {
      const rules = Array.from({ length: previous.common.packCount }, (_, index) => clonePackRule(previous.individualRules[index] ?? sharedPackRule(previous, index + 1)));
      const source = clonePackRule(rules[editingPackIndex]);
      return {
        ...previous,
        individualRules: rules.map(() => clonePackRule(source)),
        individualInitialized: true,
      };
    });
  };

  const exportSettingsBackup = () => {
    const normalizedTimers = normalizeTimerCollection(editorTimers);
    const selected = normalizedTimers.some((timer) => timer.id === draftId) ? draftId : normalizedTimers[0]?.id;
    const payload = {
      format: BACKUP_FORMAT,
      dataVersion: DATA_VERSION,
      exportedAt: new Date().toISOString(),
      selectedId: selected,
      timers: normalizedTimers,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `draft-timer-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setBackupMessage('現在の編集内容をJSONファイルへ書き出しました。');
  };

  const importSettingsBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      setBackupMessage('ファイルが大きすぎます。1MB以下のJSONファイルを選択してください。');
      return;
    }
    try {
      const imported = parseSettingsBackup(await file.text());
      setEditorTimers(imported.timers.map(cloneTimer));
      setDraftId(imported.selectedId);
      setEditingPackIndex(0);
      setBackupMessage(`${imported.timers.length}件のタイマーを読み込みました。「保存して閉じる」で反映されます。`);
    } catch (error) {
      setBackupMessage(error instanceof Error && error.message === 'unsupported-version'
        ? 'このアプリより新しい形式のバックアップは読み込めません。'
        : 'バックアップを読み込めませんでした。正しいJSONファイルか確認してください。');
    }
  };

  const resetEditorToDefaults = () => {
    const initial = cloneTimer(defaultTimer);
    setEditorTimers([initial]);
    setDraftId(initial.id);
    setEditingPackIndex(0);
    setBackupMessage('初期設定を準備しました。「保存して閉じる」で反映されます。');
  };

  const draftPackRules = Array.from(
    { length: draft.common.packCount },
    (_, index) => clonePackRule(draft.individualRules[index] ?? sharedPackRule(draft, index + 1)),
  );
  const draftPackRule = draftPackRules[editingPackIndex] ?? draftPackRules[0];

  const stepPack = currentStep?.pack ?? currentRuntime.common.packCount;
  const direction = directionForPack(currentRuntime, stepPack);
  const showPack = currentStep && !['session', 'deck', 'end'].includes(currentStep.kind);
  const showDirection = currentStep && ['pack', 'pick', 'last', 'interval'].includes(currentStep.kind);
  const mainLabel = currentStep?.kind === 'pick' ? currentStep.label : currentStep?.label ?? '準備完了';

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">DT</div>
        <div className="brand-copy">
          <p className="eyebrow">DRAFT COMPANION</p>
          <h1>Draft Timer</h1>
        </div>
        <label className="timer-select-label">
          <span>タイマー</span>
          <select value={selectedId} onChange={(event) => selectTimer(event.target.value)} aria-label="使用するタイマー">
            {timers.map((timer) => <option value={timer.id} key={timer.id}>{timer.common.name}</option>)}
          </select>
        </label>
        <button className="icon-button" type="button" aria-label="設定を開く" onClick={openSettings}>⚙</button>
      </header>

      <div className="timer-layout">
        <aside className="phase-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">PROGRESS</p><h2>フェイズ進行</h2></div>
            <span className="duration-chip">約 {estimateMinutes(current)}分</span>
          </div>
          <ol className="phase-list">
            {steps.map((step, index) => (
              <li key={`${step.kind}-${step.pack ?? 0}-${step.turn ?? 0}`}>
                <button className={index === currentIndex ? 'phase-item current' : index < currentIndex ? 'phase-item passed' : 'phase-item'} onClick={() => jumpTo(index)} type="button" aria-current={index === currentIndex ? 'step' : undefined}>
                  <span className="phase-pack">{phaseGroupLabel(step)}</span>
                  <span className="phase-copy"><strong>{step.label}</strong><small>{step.meta}</small></span>
                  {index === currentIndex && <span className="now-chip">NOW</span>}
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <section className="timer-stage">
          <div className="mobile-phase-row"><span>{currentIndex + 1} / {steps.length}</span><strong>{currentStep?.label}</strong></div>
          <div className="session-row">
            <span className={isActive && !isPaused ? 'live-dot pulsing' : 'live-dot'} aria-hidden="true" />
            <span>{current.common.name}</span>
            {showPack && <><span className="session-separator">/</span><span>{stepPack} / {current.common.packCount} パック</span></>}
          </div>

          {showDirection ? (
            <div className="direction-card">
              <span>回す方向</span><strong>{direction === 'left' ? '左隣へ' : '右隣へ'}</strong>
              <span className="direction-arrow" aria-hidden="true">{direction === 'left' ? '←' : '→'}</span>
            </div>
          ) : <div className="direction-spacer" />}

          <div className="timer-content">
            <p className="pick-label">{mainLabel}</p>
            <div className="time-display" aria-label={`残り${formatTime(remainingMs)}`}>{formatTime(remainingMs)}</div>
            <div className="time-track" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
            <p className={isActive && !isPaused ? 'status-text active' : 'status-text'} role="status">{status}</p>
          </div>

          <div className="primary-actions">
            <button className="play-button" type="button" onClick={togglePlay}>
              <span>{isActive && !isPaused ? 'Ⅱ' : '▶'}</span> {isActive && !isPaused ? '一時停止' : isPaused ? '再開' : status === '完了' ? 'もう一度' : '開始'}
            </button>
            <button className="secondary-button" type="button" onClick={resetTimer}>リセット</button>
          </div>

          <div className="navigation-actions" aria-label="フェイズ移動">
            <button type="button" onClick={() => jumpTo(currentIndex - 1)} disabled={currentIndex === 0}>← 前のフェイズ</button>
            <button type="button" onClick={() => jumpTo(currentIndex)}>このフェイズの先頭へ</button>
            <button type="button" onClick={() => jumpTo(currentIndex + 1)} disabled={currentIndex >= steps.length - 1}>次のフェイズ →</button>
          </div>
        </section>
      </div>

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSettingsOpen(false)}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <header className="settings-header">
              <div><p className="eyebrow">LOCAL SETTINGS</p><h2 id="settings-title">タイマー設定</h2></div>
              <button className="close-button" type="button" onClick={() => setSettingsOpen(false)} aria-label="閉じる">×</button>
            </header>

            <div className="settings-scroll-area">
            <div className="settings-toolbar">
              <label><span>編集するタイマー</span><select value={draft.id} onChange={(event) => selectEditorTimer(event.target.value)}>{editorTimers.map((timer) => <option value={timer.id} key={timer.id}>{timer.common.name}</option>)}</select></label>
              <div className="compact-actions"><button type="button" onClick={addTimer}>＋ 新規</button><button type="button" onClick={copyTimer}>複製</button><button className="danger" type="button" onClick={deleteTimer} disabled={editorTimers.length <= 1}>削除</button></div>
            </div>

            <div className="settings-mode-bar">
              <div><span>設定方式</span><small>{draft.mode === 'shared' ? 'すべてのパックに同じルールを適用します' : '以前の個別設定を保持し、パックごとにルールを適用します'}</small></div>
              <div className="settings-mode-toggle" role="group" aria-label="設定方式">
                <button type="button" className={draft.mode === 'shared' ? 'selected' : ''} aria-pressed={draft.mode === 'shared'} onClick={() => selectSettingsMode('shared')}>全パック共通設定</button>
                <button type="button" className={draft.mode === 'individual' ? 'selected' : ''} aria-pressed={draft.mode === 'individual'} onClick={() => selectSettingsMode('individual')}>全パック個別設定</button>
              </div>
            </div>

            {draft.mode === 'shared' ? (
              <div className="settings-grid">
                <div className="settings-column">
                  <fieldset className="settings-card">
                    <legend>基本設定</legend>
                    <label className="field full"><span>タイマー名</span><input value={draft.common.name} maxLength={30} onChange={(event) => updateCommon('name', event.target.value)} /></label>
                    <div className="field-row">
                      <label className="field"><span>パック数 / 人</span><NumberSelect value={draft.common.packCount} options={packCountOptions} onChange={updatePackCount} format={(value) => `${value}パック`} /></label>
                      <label className="field"><span>カード枚数 / パック</span><NumberSelect value={draft.sharedRule.cardCount} options={cardCountOptions} onChange={(value) => updateSharedRule({ cardCount: value })} format={(value) => `${value}枚`} /></label>
                    </div>
                    <div className="field-row">
                      <label className="field"><span>1ピックの獲得枚数</span><NumberSelect value={draft.sharedRule.cardsPerPick} options={cardsPerPickOptions} onChange={(value) => updateSharedRule({ cardsPerPick: value })} format={(value) => `${value}枚`} /></label>
                      <label className="field"><span>デッキ構築時間</span><NumberSelect value={Math.round(draft.common.deckBuildSeconds / 60)} options={deckBuildMinuteOptions} onChange={(value) => updateCommon('deckBuildSeconds', value * 60)} format={(value) => value === 0 ? 'なし' : `${value}分`} /></label>
                    </div>
                  </fieldset>

                  {draft.common.packCount > 1 && <fieldset className="settings-card"><legend>パック間インターバル</legend><div className="interval-grid">{Array.from({ length: draft.common.packCount - 1 }, (_, index) => <label className="field" key={index}><span>{index + 1} → {index + 2} パック</span><NumberSelect value={draft.common.packIntervals[index] ?? 60} options={nonNegativeSecondOptions} onChange={(value) => { const next = [...draft.common.packIntervals]; next[index] = value; updateCommon('packIntervals', next); }} format={(value) => value === 0 ? 'なし' : value >= 60 && value % 60 === 0 ? `${value}秒（${value / 60}分）` : `${value}秒`} /></label>)}</div></fieldset>}

                  <fieldset className="settings-card">
                    <legend>回す方向</legend>
                    <div className="segmented"><button type="button" className={draft.sharedRule.directionMode === 'alternate' ? 'selected' : ''} onClick={() => updateSharedRule({ directionMode: 'alternate' })}>パックごとに交互</button><button type="button" className={draft.sharedRule.directionMode === 'fixed' ? 'selected' : ''} onClick={() => updateSharedRule({ directionMode: 'fixed' })}>固定</button></div>
                    <div className="segmented compact"><button type="button" className={draft.sharedRule.initialDirection === 'left' ? 'selected' : ''} onClick={() => updateSharedRule({ initialDirection: 'left' })}>← 左から開始</button><button type="button" className={draft.sharedRule.initialDirection === 'right' ? 'selected' : ''} onClick={() => updateSharedRule({ initialDirection: 'right' })}>右から開始 →</button></div>
                    <p className="preview-line">{Array.from({ length: Math.min(3, draft.common.packCount) }, (_, index) => `${index + 1}P: ${sharedDirectionForPack(draft.sharedRule, index + 1) === 'left' ? '左' : '右'}`).join('　')}</p>
                  </fieldset>
                </div>

                <div className="settings-column">
                  <fieldset className="settings-card"><legend>カウント方式</legend><CountSettingsFields rule={sharedPackRule(draft, 1)} onChange={(count) => updateSharedRule({ count })} /></fieldset>
                  <fieldset className="settings-card">
                    <legend>音声案内</legend>
                    <label className="toggle-field"><input type="checkbox" checked={draft.common.speech.enabled} onChange={(event) => updateSpeech('enabled', event.target.checked)} /><span>ブラウザの音声で案内する</span></label>
                    <label className="field full"><span>音声</span><select value={draft.common.speech.voice} onChange={(event) => updateSpeech('voice', event.target.value)}><option value="">端末の標準音声</option>{voices.filter((voice) => voice.lang.startsWith('ja')).map((voice) => <option value={voice.name} key={voice.name}>{voice.name}</option>)}</select></label>
                    <div className="field-row"><label className="field"><span>読み上げ速度</span><NumberSelect value={draft.common.speech.rate} options={speechRateOptions} onChange={(value) => updateSpeech('rate', value)} format={(value) => `${value.toFixed(1)}×`} /></label><label className="field"><span>音量</span><NumberSelect value={draft.common.speech.volume} options={speechVolumeOptions} onChange={(value) => updateSpeech('volume', value)} format={(value) => `${Math.round(value * 100)}%`} /></label></div>
                  </fieldset>
                </div>
              </div>
            ) : (
              <div className="settings-grid individual-settings-grid">
                <div className="settings-column">
                  <fieldset className="settings-card">
                    <legend>共通設定</legend>
                    <label className="field full"><span>タイマー名</span><input value={draft.common.name} maxLength={30} onChange={(event) => updateCommon('name', event.target.value)} /></label>
                    <div className="field-row">
                      <label className="field"><span>パック数 / 人</span><NumberSelect value={draft.common.packCount} options={packCountOptions} onChange={updatePackCount} format={(value) => `${value}パック`} /></label>
                      <label className="field"><span>デッキ構築時間</span><NumberSelect value={Math.round(draft.common.deckBuildSeconds / 60)} options={deckBuildMinuteOptions} onChange={(value) => updateCommon('deckBuildSeconds', value * 60)} format={(value) => value === 0 ? 'なし' : `${value}分`} /></label>
                    </div>
                  </fieldset>

                  {draft.common.packCount > 1 && <fieldset className="settings-card"><legend>パック間インターバル</legend><div className="interval-grid">{Array.from({ length: draft.common.packCount - 1 }, (_, index) => <label className="field" key={index}><span>{index + 1} → {index + 2} パック</span><NumberSelect value={draft.common.packIntervals[index] ?? 60} options={nonNegativeSecondOptions} onChange={(value) => { const next = [...draft.common.packIntervals]; next[index] = value; updateCommon('packIntervals', next); }} format={(value) => value === 0 ? 'なし' : value >= 60 && value % 60 === 0 ? `${value}秒（${value / 60}分）` : `${value}秒`} /></label>)}</div></fieldset>}

                  <fieldset className="settings-card">
                    <legend>音声案内</legend>
                    <label className="toggle-field"><input type="checkbox" checked={draft.common.speech.enabled} onChange={(event) => updateSpeech('enabled', event.target.checked)} /><span>ブラウザの音声で案内する</span></label>
                    <label className="field full"><span>音声</span><select value={draft.common.speech.voice} onChange={(event) => updateSpeech('voice', event.target.value)}><option value="">端末の標準音声</option>{voices.filter((voice) => voice.lang.startsWith('ja')).map((voice) => <option value={voice.name} key={voice.name}>{voice.name}</option>)}</select></label>
                    <div className="field-row"><label className="field"><span>読み上げ速度</span><NumberSelect value={draft.common.speech.rate} options={speechRateOptions} onChange={(value) => updateSpeech('rate', value)} format={(value) => `${value.toFixed(1)}×`} /></label><label className="field"><span>音量</span><NumberSelect value={draft.common.speech.volume} options={speechVolumeOptions} onChange={(value) => updateSpeech('volume', value)} format={(value) => `${Math.round(value * 100)}%`} /></label></div>
                  </fieldset>
                </div>

                <div className="settings-column">
                  <fieldset className="settings-card pack-settings-card">
                    <legend>パックごとの設定</legend>
                    <div className="pack-copy-actions">
                      <button type="button" onClick={copyPreviousPackRule} disabled={editingPackIndex === 0}>前のパックからコピー</button>
                      <button type="button" onClick={applyCurrentPackRuleToFollowing} disabled={editingPackIndex >= draft.common.packCount - 1}>この設定を以降へ適用</button>
                      <button type="button" onClick={applyCurrentPackRuleToAll}>この設定を全パックへ適用</button>
                      <button type="button" onClick={applySharedRuleToAllPacks}>共通ルールで全パックを作り直す</button>
                    </div>
                    <p className="pack-settings-note">初回は共通設定から作成され、以後は個別設定として保持されます。</p>
                    <div className="pack-tabs" role="tablist" aria-label="設定するパック">
                      {draftPackRules.map((rule, index) => (
                        <button
                          type="button"
                          role="tab"
                          aria-selected={editingPackIndex === index}
                          aria-label={`${index + 1}パック目、${rule.cardCount}枚、1回${rule.cardsPerPick}枚、${rule.direction === 'left' ? '左' : '右'}、${countTypeLabel(rule.count)}`}
                          className={editingPackIndex === index ? 'selected' : ''}
                          onClick={() => setEditingPackIndex(index)}
                          key={index}
                        >
                          <span>{index + 1}パック目</span>
                          <small>{rule.cardCount}枚・{rule.cardsPerPick}枚・{rule.direction === 'left' ? '左' : '右'}・{countTypeLabel(rule.count)}</small>
                        </button>
                      ))}
                    </div>
                    <div className="pack-settings-panel" role="tabpanel" aria-label={`${editingPackIndex + 1}パック目の設定`}>
                      <div className="pack-panel-heading"><strong>{editingPackIndex + 1}パック目</strong><span>{draftPackRule.cardCount}枚・1回{draftPackRule.cardsPerPick}枚ピック</span></div>
                      <div className="field-row">
                        <label className="field"><span>カード枚数</span><NumberSelect value={draftPackRule.cardCount} options={cardCountOptions} onChange={(value) => updatePackRule({ cardCount: value })} format={(value) => `${value}枚`} /></label>
                        <label className="field"><span>1ピックの獲得枚数</span><NumberSelect value={draftPackRule.cardsPerPick} options={cardsPerPickOptions} onChange={(value) => updatePackRule({ cardsPerPick: value })} format={(value) => `${value}枚`} /></label>
                      </div>
                      <section className="pack-rule-section" aria-labelledby={`direction-heading-${editingPackIndex}`}>
                        <h3 id={`direction-heading-${editingPackIndex}`}>回す方向</h3>
                        <div className="segmented compact"><button type="button" className={draftPackRule.direction === 'left' ? 'selected' : ''} aria-pressed={draftPackRule.direction === 'left'} onClick={() => updatePackRule({ direction: 'left' })}>← 左隣へ</button><button type="button" className={draftPackRule.direction === 'right' ? 'selected' : ''} aria-pressed={draftPackRule.direction === 'right'} onClick={() => updatePackRule({ direction: 'right' })}>右隣へ →</button></div>
                      </section>
                      <section className="pack-rule-section" aria-labelledby={`count-heading-${editingPackIndex}`}>
                        <h3 id={`count-heading-${editingPackIndex}`}>カウント方式</h3>
                        <CountSettingsFields rule={draftPackRule} onChange={(count) => updatePackRule({ count })} />
                      </section>
                    </div>
                  </fieldset>
                </div>
              </div>
            )}

            <details className="settings-data-tools">
              <summary>
                <span><strong>設定データのバックアップ</strong><small>端末の外へ保存・復元できます</small></span>
                <span className="data-version">データ形式 v{DATA_VERSION}</span>
              </summary>
              <div className="settings-data-tools-body">
                <p>JSONの読み込みや初期化は一時編集として扱われます。「保存して閉じる」を押すまで実際の設定には反映されません。</p>
                <div>
                  <button type="button" onClick={exportSettingsBackup}>JSONを書き出す</button>
                  <button type="button" onClick={() => importInputRef.current?.click()}>JSONを読み込む</button>
                  <button className="danger" type="button" onClick={resetEditorToDefaults}>すべて初期設定へ戻す</button>
                  <input ref={importInputRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={importSettingsBackup} tabIndex={-1} aria-hidden="true" />
                </div>
                {backupMessage && <p className="backup-message" role="status">{backupMessage}</p>}
              </div>
            </details>

            <footer className="settings-footer"><span>予想所要時間：約 {estimateMinutes(draft)}分</span><div><button className="secondary-button" type="button" onClick={() => setSettingsOpen(false)}>キャンセル</button><button className="save-button" type="button" onClick={saveSettings} disabled={!draft.common.name.trim()}>保存して閉じる</button></div></footer>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
