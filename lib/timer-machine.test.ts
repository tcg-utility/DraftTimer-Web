import { describe, expect, it } from 'vitest';
import {
  createIdleTimerState,
  isTimerPaused,
  timerRemainingMs,
  timerStatusLabel,
  timerStepIndex,
  transitionTimerState,
  type ActiveTimerState,
} from './timer-machine';

const countingState = (runId = 1): ActiveTimerState => ({
  type: 'counting',
  runId,
  stepIndex: 2,
  remainingMs: 15_000,
  countdown: 'pick',
});

describe('timer machine', () => {
  it('一時停止中は経過イベントを無視し、再開後に同じ残り時間から進む', () => {
    let state = transitionTimerState(createIdleTimerState(15_000), {
      type: 'START_RUN',
      runId: 1,
      initial: countingState(),
      paused: false,
    });

    state = transitionTimerState(state, { type: 'TICK', runId: 1, remainingMs: 9_500 });
    state = transitionTimerState(state, { type: 'PAUSE' });
    expect(isTimerPaused(state)).toBe(true);
    expect(timerRemainingMs(state)).toBe(9_500);
    expect(timerStatusLabel(state)).toBe('一時停止中');

    state = transitionTimerState(state, { type: 'TICK', runId: 1, remainingMs: 1_000 });
    expect(timerRemainingMs(state)).toBe(9_500);

    state = transitionTimerState(state, { type: 'RESUME' });
    state = transitionTimerState(state, { type: 'TICK', runId: 1, remainingMs: 8_000 });
    expect(timerRemainingMs(state)).toBe(8_000);
    expect(timerStatusLabel(state)).toBe('カウント中');
  });

  it('古い実行IDのイベントを無視する', () => {
    const current = countingState(4);
    const afterStaleTick = transitionTimerState(current, { type: 'TICK', runId: 3, remainingMs: 0 });
    const afterStaleComplete = transitionTimerState(current, {
      type: 'COMPLETE',
      runId: 3,
      stepIndex: 9,
      remainingMs: 0,
    });

    expect(afterStaleTick).toEqual(current);
    expect(afterStaleComplete).toEqual(current);
  });

  it('リセットと完了で表示状態を確定する', () => {
    const reset = transitionTimerState(countingState(), {
      type: 'RESET',
      runId: 2,
      stepIndex: 0,
      remainingMs: 40_000,
    });
    expect(timerStepIndex(reset)).toBe(0);
    expect(timerRemainingMs(reset)).toBe(40_000);
    expect(timerStatusLabel(reset)).toBe('停止中');

    const completed = transitionTimerState(countingState(), {
      type: 'COMPLETE',
      runId: 1,
      stepIndex: 52,
      remainingMs: 0,
    });
    expect(timerStepIndex(completed)).toBe(52);
    expect(timerRemainingMs(completed)).toBe(0);
    expect(timerStatusLabel(completed)).toBe('完了');
  });
});
