import { beforeEach, describe, expect, it } from 'vitest';
import { cloneTimer, defaultTimer } from '@/lib/timer-domain';
import { createIdleTimerState, transitionTimerState } from '@/lib/timer-machine';
import {
  createProgressSnapshot,
  readProgress,
  readSettings,
  timerSignature,
  writeProgress,
  writeSettings,
} from '@/lib/settings-storage';

beforeEach(() => localStorage.clear());

describe('settings storage', () => {
  it('旧形式の設定を現行形式へ移行して読み込む', () => {
    localStorage.setItem('drafttimer:web:v1', JSON.stringify({
      timers: [{ id: 'legacy', name: '旧タイマー', packCount: 2, cardCount: 16, cardsPerPick: 2, countType: 'fixed', fixedSeconds: 20 }],
      selectedId: 'legacy',
    }));
    const saved = readSettings();
    expect(saved?.selectedId).toBe('legacy');
    expect(saved?.timers[0]).toMatchObject({ schemaVersion: 3, common: { name: '旧タイマー', packCount: 2 }, sharedRule: { cardCount: 16, cardsPerPick: 2, takeAll: true, takeCount: 15, count: { type: 'fixed', seconds: 20 } } });
  });

  it('保存領域が利用できない場合は例外にせず結果で通知する', () => {
    const denied = { setItem: () => { throw new DOMException('denied', 'QuotaExceededError'); } } as unknown as Storage;
    expect(writeSettings({ timers: [cloneTimer(defaultTimer)], selectedId: defaultTimer.id }, denied)).toEqual({ ok: false, reason: 'quota' });
  });

  it('カウント中の残り時間を保存し、同じ設定だけで復元する', () => {
    const timer = cloneTimer(defaultTimer);
    let machine = createIdleTimerState(40_000);
    machine = transitionTimerState(machine, {
      type: 'START_RUN',
      runId: 1,
      paused: false,
      initial: { type: 'counting', runId: 1, stepIndex: 2, remainingMs: 12_345, countdown: 'pick' },
    });
    const snapshot = createProgressSnapshot(timer, machine);
    expect(snapshot?.active).toMatchObject({ type: 'counting', stepIndex: 2, remainingMs: 12_345, countdown: 'pick' });
    expect(snapshot && writeProgress(snapshot).ok).toBe(true);
    expect(readProgress([timer])?.timerSignature).toBe(timerSignature(timer));

    const changed = cloneTimer(timer);
    changed.common.packCount = 1;
    expect(readProgress([changed])).toBeNull();
  });
});
