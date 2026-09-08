import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimerRunner } from '@/hooks/use-timer-runner';
import { cloneTimer, defaultTimer } from '@/lib/timer-domain';

class MockUtterance {
  voice: SpeechSynthesisVoice | null = null;
  lang = '';
  rate = 1;
  volume = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

describe('speech pause and resume', () => {
  const spoken: MockUtterance[] = [];

  beforeEach(() => {
    spoken.length = 0;
    vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance);
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [],
        speak: (utterance: MockUtterance) => spoken.push(utterance),
        cancel: vi.fn(),
      },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('一時停止で中断した案内を再開時に先頭から読み直す', async () => {
    const timer = cloneTimer(defaultTimer);
    const { result, unmount } = renderHook(() => useTimerRunner(timer));
    act(() => result.current.beginRun(0));
    await waitFor(() => expect(spoken).toHaveLength(1));

    await act(async () => {
      result.current.pauseTimer();
      await Promise.resolve();
    });
    expect(result.current.machine.type).toBe('paused');
    act(() => result.current.resumeTimer());
    await waitFor(() => expect(spoken).toHaveLength(2));
    expect(spoken[1].text).toBe(spoken[0].text);
    unmount();
  });
});
