import { describe, expect, it } from 'vitest';
import {
  buildPickPhasePreview,
  buildSteps,
  compileTimer,
  estimateMinutes,
  normalizeTimer,
  type TimerSettings,
} from './page';

function sharedTimer(overrides: Record<string, unknown> = {}): TimerSettings {
  return normalizeTimer({
    id: 'test-timer',
    name: 'テストタイマー',
    packCount: 1,
    cardCount: 2,
    cardsPerPick: 1,
    packIntervals: [],
    deckBuildSeconds: 0,
    countType: 'fixed',
    fixedSeconds: 15,
    directionMode: 'fixed',
    initialDirection: 'left',
    speechEnabled: true,
    speechVoice: '',
    speechRate: 1,
    speechVolume: 1,
    ...overrides,
  });
}

describe('draft phase generation', () => {
  it('20枚を3枚ずつ取る場合、6回を計時し最後の2枚は計時しない', () => {
    const timer = sharedTimer({
      cardCount: 20,
      cardsPerPick: 3,
      countType: 'perCard',
      perCardSeconds: [40, 35, 30, 25, 20, 15],
    });
    const runtime = compileTimer(timer);
    const steps = buildSteps(runtime);
    const picks = steps.filter((step) => step.kind === 'pick');
    const last = steps.find((step) => step.kind === 'last');

    expect(picks).toHaveLength(6);
    expect(picks.map((step) => step.seconds)).toEqual([40, 35, 30, 25, 20, 15]);
    expect(last).toMatchObject({ cards: 2, seconds: 0, label: '最後の2枚' });
  });

  it('階段方式の秒数を実際の残枚数から計算する', () => {
    const timer = sharedTimer({
      cardCount: 6,
      cardsPerPick: 2,
      countType: 'step',
      baseSeconds: 0,
      stepDecrease: 3,
    });
    const runtime = compileTimer(timer);
    const picks = buildSteps(runtime).filter((step) => step.kind === 'pick');
    const preview = buildPickPhasePreview(runtime.packs[0]);

    expect(picks.map((step) => step.seconds)).toEqual([15, 9]);
    expect(preview).toEqual([
      { turn: 1, label: '1〜2枚目', seconds: 15, finalCards: null },
      { turn: 2, label: '3〜4枚目', seconds: 9, finalCards: null },
      { turn: 3, label: '5〜6枚目', seconds: null, finalCards: 2 },
    ]);
  });

  it('パック個別設定をパックごとの実行データへ変換する', () => {
    const timer = normalizeTimer({
      schemaVersion: 2,
      id: 'individual-test',
      mode: 'individual',
      common: {
        name: '個別テスト',
        packCount: 2,
        packIntervals: [0],
        deckBuildSeconds: 0,
        speech: { enabled: true, voice: '', rate: 1, volume: 1 },
      },
      sharedRule: {
        cardCount: 15,
        cardsPerPick: 1,
        directionMode: 'alternate',
        initialDirection: 'left',
        count: { type: 'fixed', seconds: 40 },
      },
      individualInitialized: true,
      individualRules: [
        { cardCount: 4, cardsPerPick: 1, direction: 'right', count: { type: 'fixed', seconds: 10 } },
        { cardCount: 6, cardsPerPick: 2, direction: 'left', count: { type: 'step', baseSeconds: 0, decreaseSeconds: 3 } },
      ],
    });
    const runtime = compileTimer(timer);

    expect(runtime.packs.map((pack) => [pack.cardCount, pack.cardsPerPick, pack.direction])).toEqual([
      [4, 1, 'right'],
      [6, 2, 'left'],
    ]);
    expect(buildSteps(runtime).filter((step) => step.kind === 'pick').map((step) => step.seconds)).toEqual([
      10, 10, 10, 15, 9,
    ]);
  });
});

describe('duration estimate and data normalization', () => {
  it('音声オン・オフと読み上げ速度を予想時間へ反映しない', () => {
    const enabled = sharedTimer({ speechEnabled: true, speechRate: 0.5 });
    const disabled = sharedTimer({ speechEnabled: false, speechRate: 2 });

    expect(estimateMinutes(enabled)).toBe(estimateMinutes(disabled));
    expect(estimateMinutes(enabled)).toMatch(/^\d+\.\d$/);
  });

  it('構築時間と案内を単一の予想所要時間へ加算する', () => {
    const withoutDeck = Number(estimateMinutes(sharedTimer()));
    const withDeck = Number(estimateMinutes(sharedTimer({ deckBuildSeconds: 1_200 })));

    expect(withDeck - withoutDeck).toBeGreaterThan(20);
    expect(withDeck - withoutDeck).toBeLessThan(20.5);
  });

  it('保存値を許容範囲へ補正する', () => {
    const normalized = sharedTimer({
      packCount: 99,
      cardCount: 1,
      cardsPerPick: 99,
      fixedSeconds: 0,
      deckBuildSeconds: 99_999,
      speechRate: 9,
      speechVolume: -1,
    });

    expect(normalized.common.packCount).toBe(10);
    expect(normalized.common.deckBuildSeconds).toBe(7_200);
    expect(normalized.common.speech.rate).toBe(2);
    expect(normalized.common.speech.volume).toBe(0);
    expect(normalized.sharedRule.cardCount).toBe(2);
    expect(normalized.sharedRule.cardsPerPick).toBe(5);
    expect(normalized.sharedRule.count).toEqual({ type: 'fixed', seconds: 1 });
  });
});
