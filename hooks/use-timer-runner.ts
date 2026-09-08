'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  activeStateForStep,
  buildSteps,
  clamp,
  cloneTimer,
  compileTimer,
  initialDisplaySeconds,
  stepFixedDelaySeconds,
  stepSpeechCues,
  type DraftStep,
  type RuntimeSettings,
  type TimerSettings,
} from '@/lib/timer-domain';
import {
  createIdleTimerState,
  isTimerPaused,
  isTimerRunning,
  timerStepIndex,
  transitionTimerState,
  type ActiveTimerState,
  type AnnouncementKind,
  type CountdownKind,
  type TimerMachineEvent,
  type TimerMachineState,
} from '@/lib/timer-machine';
import type { ProgressSnapshot, StoredActiveState } from '@/lib/settings-storage';
import { SpeechController } from '@/lib/speech-controller';

const UI_TICK_MS = 150;
const PAUSE_POLL_MS = 60;
const monotonicNow = () => performance.now();

type WakeLockStatus = 'available' | 'active' | 'blocked' | 'unsupported';
type WakeLockSentinel = { release: () => Promise<void>; addEventListener?: (type: 'release', listener: () => void) => void };

export function useTimerRunner(current: TimerSettings, onComplete?: () => void) {
  const initialRuntime = compileTimer(current);
  const initialSteps = buildSteps(initialRuntime);
  const [machine, setMachine] = useState<TimerMachineState>(() =>
    createIdleTimerState(initialDisplaySeconds(initialRuntime, initialSteps[0]) * 1000),
  );
  const [wakeLockStatus, setWakeLockStatus] = useState<WakeLockStatus>('unsupported');
  const machineRef = useRef(machine);
  const runTokenRef = useRef(0);
  const speechPauseTokenRef = useRef(0);
  const speechControllerRef = useRef<SpeechController | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const completeRef = useRef(onComplete);

  useEffect(() => {
    completeRef.current = onComplete;
  }, [onComplete]);

  const sendMachine = useCallback((event: TimerMachineEvent) => {
    const next = transitionTimerState(machineRef.current, event);
    machineRef.current = next;
    setMachine(next);
    return next;
  }, []);

  const speechController = () => {
    if (!speechControllerRef.current) speechControllerRef.current = new SpeechController();
    return speechControllerRef.current;
  };

  const stopSpeech = useCallback(() => speechControllerRef.current?.stop(), []);

  const halt = useCallback(() => {
    const runId = runTokenRef.current + 1;
    runTokenRef.current = runId;
    stopSpeech();
    return runId;
  }, [stopSpeech]);

  const resetProgressFor = useCallback((settings: TimerSettings) => {
    const runId = halt();
    const runtime = compileTimer(settings);
    const sequence = buildSteps(runtime);
    sendMachine({
      type: 'RESET',
      runId,
      stepIndex: 0,
      remainingMs: initialDisplaySeconds(runtime, sequence[0]) * 1000,
    });
  }, [halt, sendMachine]);

  const waitForResume = async (runId: number) => {
    while (runTokenRef.current === runId && isTimerPaused(machineRef.current)) {
      await new Promise((resolve) => setTimeout(resolve, PAUSE_POLL_MS));
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
      await new Promise((resolve) => setTimeout(resolve, Math.min(PAUSE_POLL_MS, left)));
      assertCurrentRun(runId);
      if (!isTimerPaused(machineRef.current)) left -= monotonicNow() - startedAt;
    }
  };

  const speakPausable = async (text: string, settings: RuntimeSettings, runId: number) => {
    if (!settings.common.speech.enabled) return;
    while (runTokenRef.current === runId && isTimerRunning(machineRef.current)) {
      await waitForResume(runId);
      const pauseToken = speechPauseTokenRef.current;
      const result = await speechController().speak(text, settings.common.speech);
      if (result === 'ended') return;
      if (speechPauseTokenRef.current === pauseToken) throw new Error('cancelled');
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

  const enterCountdown = (stepIndex: number, runId: number, countdown: CountdownKind, remainingMs: number) => {
    sendMachine({ type: 'ENTER_COUNTDOWN', runId, stepIndex, remainingMs, countdown });
  };

  const countdown = async (milliseconds: number, settings: RuntimeSettings, runId: number) => {
    let left = milliseconds;
    const startWhole = Math.ceil(left / 1000);
    let lastSpoken: number | null = null;
    let lastRenderedAt = monotonicNow() - UI_TICK_MS;
    while (left > 0) {
      await waitForResume(runId);
      const startedAt = monotonicNow();
      await new Promise((resolve) => setTimeout(resolve, Math.min(50, left)));
      assertCurrentRun(runId);
      if (!isTimerPaused(machineRef.current)) left = Math.max(0, left - (monotonicNow() - startedAt));
      const now = monotonicNow();
      if (now - lastRenderedAt >= UI_TICK_MS || left === 0) {
        sendMachine({ type: 'TICK', runId, remainingMs: left });
        lastRenderedAt = now;
      }
      const whole = Math.ceil(left / 1000);
      if (whole !== lastSpoken) {
        const isInitialSecond = lastSpoken === null && whole === startWhole;
        lastSpoken = whole;
        if (!isInitialSecond) {
          if (whole > 30 && whole % 60 === 0) announceNumber(`残り${whole / 60}分です`, settings);
          else if (whole > 0 && whole <= 30 && whole % 10 === 0) announceNumber(`残り${whole}秒です`, settings);
        }
        if (whole === 3 || whole === 2 || whole === 1) announceNumber(String(whole), settings);
      }
    }
    sendMachine({ type: 'TICK', runId, remainingMs: 0 });
  };

  const finishTimedStep = async (step: DraftStep, stepIndex: number, settings: RuntimeSettings, runId: number) => {
    const cues = stepSpeechCues(step, settings);
    const fixedDelayMs = stepFixedDelaySeconds(step) * 1000;
    stopSpeech();
    if (step.kind === 'pick') {
      sendMachine({ type: 'ENTER_PASS_GUIDANCE', runId, stepIndex, remainingMs: 0 });
      await speakPausable(cues[1], settings, runId);
    } else if (step.kind === 'interval') {
      enterAnnouncement(step, stepIndex, settings, runId, 'intervalEnd');
      await speakPausable(cues[1], settings, runId);
    } else if (step.kind === 'deck') {
      enterAnnouncement(step, stepIndex, settings, runId, 'deckEnd');
      await speakPausable(cues[1], settings, runId);
    }
    await sleepPausable(fixedDelayMs, runId);
  };

  const executeStep = async (step: DraftStep, stepIndex: number, settings: RuntimeSettings, runId: number) => {
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
      enterCountdown(stepIndex, runId, 'pick', step.seconds * 1000);
      await countdown(step.seconds * 1000, settings, runId);
      await finishTimedStep(step, stepIndex, settings, runId);
    } else if (step.kind === 'last') {
      const label = step.cards && step.cards > 1 ? `最後の${step.cards}枚` : '最後のカード';
      enterAnnouncement(step, stepIndex, settings, runId, 'lastPick', label);
      await speakPausable(cues[0], settings, runId);
    } else if (step.kind === 'interval') {
      enterAnnouncement(step, stepIndex, settings, runId, 'intervalStart');
      await speakPausable(cues[0], settings, runId);
      enterCountdown(stepIndex, runId, 'interval', step.seconds * 1000);
      await countdown(step.seconds * 1000, settings, runId);
      await finishTimedStep(step, stepIndex, settings, runId);
    } else if (step.kind === 'deck') {
      enterAnnouncement(step, stepIndex, settings, runId, 'deckStart');
      await speakPausable(cues[0], settings, runId);
      enterCountdown(stepIndex, runId, 'deck', step.seconds * 1000);
      await countdown(step.seconds * 1000, settings, runId);
      await finishTimedStep(step, stepIndex, settings, runId);
    } else {
      enterAnnouncement(step, stepIndex, settings, runId, 'sessionEnd');
      await speakPausable(cues[0], settings, runId);
      await speakPausable(cues[1], settings, runId);
    }
  };

  const executeRestoredStep = async (
    restored: StoredActiveState,
    step: DraftStep,
    stepIndex: number,
    settings: RuntimeSettings,
    runId: number,
  ) => {
    if (restored.type === 'counting' && ['pick', 'interval', 'deck'].includes(step.kind)) {
      const maximum = Math.max(0, step.seconds * 1000);
      const remainingMs = clamp(restored.remainingMs, 0, maximum);
      enterCountdown(stepIndex, runId, restored.countdown, remainingMs);
      await countdown(remainingMs, settings, runId);
      await finishTimedStep(step, stepIndex, settings, runId);
      return;
    }
    if (restored.type === 'passGuidance' && step.kind === 'pick') {
      sendMachine({ type: 'ENTER_PASS_GUIDANCE', runId, stepIndex, remainingMs: 0 });
      await speakPausable(stepSpeechCues(step, settings)[1], settings, runId);
      await sleepPausable(stepFixedDelaySeconds(step) * 1000, runId);
      return;
    }
    await executeStep(step, stepIndex, settings, runId);
  };

  const startSequence = (
    settingsSnapshot: RuntimeSettings,
    sequence: DraftStep[],
    startIndex: number,
    runId: number,
    restored?: StoredActiveState,
  ) => {
    void (async () => {
      try {
        await waitForResume(runId);
        if (restored) await executeRestoredStep(restored, sequence[startIndex], startIndex, settingsSnapshot, runId);
        else await executeStep(sequence[startIndex], startIndex, settingsSnapshot, runId);
        for (let index = startIndex + 1; index < sequence.length; index += 1) {
          await waitForResume(runId);
          await executeStep(sequence[index], index, settingsSnapshot, runId);
        }
        if (runTokenRef.current === runId) {
          sendMachine({ type: 'COMPLETE', runId, stepIndex: sequence.length - 1, remainingMs: 0 });
          completeRef.current?.();
        }
      } catch {
        // Reset, settings changes and phase jumps intentionally cancel the old run.
      }
    })();
  };

  const beginRun = useCallback((requestedIndex = timerStepIndex(machineRef.current), startPaused = false) => {
    const settingsSnapshot = compileTimer(cloneTimer(current));
    const sequence = buildSteps(settingsSnapshot);
    const startIndex = clamp(requestedIndex, 0, Math.max(0, sequence.length - 1));
    const runId = halt();
    sendMachine({
      type: 'START_RUN',
      runId,
      initial: activeStateForStep(sequence[startIndex], startIndex, settingsSnapshot, runId),
      paused: startPaused,
    });
    startSequence(settingsSnapshot, sequence, startIndex, runId);
  // Async runner helpers intentionally use refs so a render never replaces an active run.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, halt, sendMachine]);

  const restoreProgress = useCallback((snapshot: ProgressSnapshot) => {
    if (snapshot.timerId !== current.id) return false;
    const settingsSnapshot = compileTimer(cloneTimer(current));
    const sequence = buildSteps(settingsSnapshot);
    const startIndex = snapshot.active.stepIndex;
    if (!sequence[startIndex]) return false;
    const runId = halt();
    const active = { ...snapshot.active, runId } as ActiveTimerState;
    sendMachine({ type: 'START_RUN', runId, initial: active, paused: true });
    startSequence(settingsSnapshot, sequence, startIndex, runId, snapshot.active);
    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, halt, sendMachine]);

  const pauseTimer = useCallback(() => {
    if (!isTimerRunning(machineRef.current) || isTimerPaused(machineRef.current)) return;
    sendMachine({ type: 'PAUSE' });
    speechPauseTokenRef.current += 1;
    stopSpeech();
  }, [sendMachine, stopSpeech]);

  const resumeTimer = useCallback(() => {
    if (isTimerPaused(machineRef.current)) sendMachine({ type: 'RESUME' });
  }, [sendMachine]);

  const togglePlay = useCallback(() => {
    const state = machineRef.current;
    if (isTimerRunning(state) && !isTimerPaused(state)) return pauseTimer();
    if (isTimerPaused(state)) return resumeTimer();
    beginRun(state.type === 'completed' ? 0 : timerStepIndex(state));
  }, [beginRun, pauseTimer, resumeTimer]);

  const jumpTo = useCallback((index: number, forcePaused?: boolean) => {
    const state = machineRef.current;
    const restart = isTimerRunning(state);
    const stayPaused = forcePaused ?? isTimerPaused(state);
    const sequence = buildSteps(compileTimer(current));
    const bounded = clamp(index, 0, Math.max(0, sequence.length - 1));
    const runId = halt();
    if (restart) {
      beginRun(bounded, stayPaused);
      return;
    }
    const runtime = compileTimer(current);
    sendMachine({ type: 'RESET', runId, stepIndex: bounded, remainingMs: initialDisplaySeconds(runtime, sequence[bounded]) * 1000 });
  }, [beginRun, current, halt, sendMachine]);

  const requestWakeLock = useCallback(async () => {
    await Promise.resolve();
    if (wakeLockRef.current || typeof navigator === 'undefined') return;
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> } }).wakeLock;
    if (!wakeLock) {
      setWakeLockStatus('unsupported');
      return;
    }
    try {
      const sentinel = await wakeLock.request('screen');
      wakeLockRef.current = sentinel;
      setWakeLockStatus('active');
      sentinel.addEventListener?.('release', () => {
        wakeLockRef.current = null;
        setWakeLockStatus('available');
      });
    } catch {
      setWakeLockStatus('blocked');
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    const sentinel = wakeLockRef.current;
    wakeLockRef.current = null;
    await sentinel?.release().catch(() => undefined);
    setWakeLockStatus(typeof navigator !== 'undefined' && 'wakeLock' in navigator ? 'available' : 'unsupported');
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setWakeLockStatus('wakeLock' in navigator ? 'available' : 'unsupported'));
    return () => cancelAnimationFrame(frame);
  }, []);

  const machineIsRunning = isTimerRunning(machine);
  useEffect(() => {
    let currentEffect = true;
    queueMicrotask(() => {
      if (!currentEffect) return;
      if (machineIsRunning) void requestWakeLock();
      else void releaseWakeLock();
    });
    return () => { currentEffect = false; };
  }, [machineIsRunning, releaseWakeLock, requestWakeLock]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        if (isTimerRunning(machineRef.current) && !isTimerPaused(machineRef.current)) pauseTimer();
      } else if (isTimerRunning(machineRef.current)) {
        void requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [pauseTimer, requestWakeLock]);

  useEffect(() => () => {
    runTokenRef.current += 1;
    speechControllerRef.current?.stop();
    void releaseWakeLock();
  }, [releaseWakeLock]);

  const testSpeech = useCallback(() => {
    speechController().announce('音声案内のテストです', current.common.speech);
  }, [current]);

  return {
    machine,
    machineRef,
    wakeLockStatus,
    beginRun,
    restoreProgress,
    pauseTimer,
    resumeTimer,
    togglePlay,
    jumpTo,
    resetProgressFor,
    testSpeech,
  };
}
