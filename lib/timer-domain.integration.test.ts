import { describe, expect, it } from 'vitest';
import { buildSteps, cloneTimer, compileTimer, defaultTimer, type PackRule } from '@/lib/timer-domain';

describe('complete phase sequence', () => {
  it('複数パック・インターバル・構築時間を順番どおり生成する', () => {
    const timer = cloneTimer(defaultTimer);
    timer.mode = 'individual';
    timer.common.packCount = 3;
    timer.common.packIntervals = [7, 9];
    timer.common.deckBuildSeconds = 11;
    const pack = (cardCount: number, cardsPerPick: number, direction: 'left' | 'right'): PackRule => ({ cardCount, cardsPerPick, direction, count: { type: 'fixed', seconds: 2 } });
    timer.individualRules = [pack(5, 2, 'left'), pack(4, 1, 'right'), pack(6, 3, 'left')];
    timer.individualInitialized = true;

    const steps = buildSteps(compileTimer(timer));
    expect(steps.filter((step) => step.kind === 'pack').map((step) => step.pack)).toEqual([1, 2, 3]);
    expect(steps.filter((step) => step.kind === 'interval').map((step) => step.seconds)).toEqual([7, 9]);
    expect(steps.filter((step) => step.kind === 'pick')).toHaveLength(6);
    expect(steps.at(-2)).toMatchObject({ kind: 'deck', seconds: 11 });
    expect(steps.at(-1)?.kind).toBe('end');
  });
});
