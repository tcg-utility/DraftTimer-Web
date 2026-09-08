'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibleDialog } from '@/components/accessible-dialog';
import { SettingsModal } from '@/components/settings-modal';
import { TimerScreen } from '@/components/timer-screen';
import { useServiceWorkerUpdate } from '@/hooks/use-service-worker-update';
import { useTimerRunner } from '@/hooks/use-timer-runner';
import { estimateMinutes } from '@/lib/duration-estimator';
import { buildSteps, cloneTimer, compileTimer, defaultTimer, type TimerSettings } from '@/lib/timer-domain';
import {
  clearProgress,
  createProgressSnapshot,
  readProgress,
  readSettings,
  writeProgress,
  writeSettings,
  type ProgressSnapshot,
} from '@/lib/settings-storage';
import { isTimerPaused, isTimerRunning, timerStepIndex } from '@/lib/timer-machine';

export { buildPickPhasePreview, buildSteps, compileTimer, normalizeTimer, parseSettingsBackup, turnSeconds } from '@/lib/timer-domain';
export { estimateMinutes } from '@/lib/duration-estimator';
export type { CountSettings, DraftStep, PackRule, RuntimeSettings, TimerSettings } from '@/lib/timer-domain';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

type PendingAction =
  | { type: 'reset'; wasPlaying: boolean }
  | { type: 'jump'; index: number; wasPlaying: boolean };

export default function Home() {
  const [timers, setTimers] = useState<TimerSettings[]>([defaultTimer]);
  const [selectedId, setSelectedId] = useState(defaultTimer.id);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [pendingRecovery, setPendingRecovery] = useState<ProgressSnapshot | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [ready, setReady] = useState(false);
  const [storageWarning, setStorageWarning] = useState('');
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const currentRef = useRef(defaultTimer);

  const current = timers.find((timer) => timer.id === selectedId) ?? timers[0] ?? defaultTimer;
  const currentRuntime = useMemo(() => compileTimer(current), [current]);
  const steps = useMemo(() => buildSteps(currentRuntime), [currentRuntime]);
  const estimatedDuration = useMemo(() => estimateMinutes(current), [current]);
  const runner = useTimerRunner(current, clearProgress);
  const { updateAvailable, applyUpdate } = useServiceWorkerUpdate(BASE_PATH);
  const isActive = isTimerRunning(runner.machine);
  const isPaused = isTimerPaused(runner.machine);

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  /* eslint-disable react-hooks/set-state-in-effect -- browser-only local data is intentionally hydrated after mount */
  useEffect(() => {
    const saved = readSettings();
    const restoredTimers = saved?.timers ?? [cloneTimer(defaultTimer)];
    const recovery = readProgress(restoredTimers);
    const nextId = recovery?.timerId ?? saved?.selectedId ?? restoredTimers[0].id;
    const selected = restoredTimers.find((timer) => timer.id === nextId) ?? restoredTimers[0];
    setTimers(restoredTimers);
    setSelectedId(selected.id);
    runner.resetProgressFor(selected);
    setPendingRecovery(recovery);
    setReady(true);
  // Initial local data is loaded once; later changes are handled by explicit actions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!ready) return;
    const result = writeSettings({ timers, selectedId });
    if (!result.ok) queueMicrotask(() => setStorageWarning('端末への設定保存に失敗しました。JSONバックアップを保存してください。'));
  }, [ready, selectedId, timers]);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const saveCurrentProgress = () => {
      const snapshot = createProgressSnapshot(currentRef.current, runner.machineRef.current);
      if (!snapshot) return;
      const result = writeProgress(snapshot);
      if (!result.ok) setStorageWarning('進行状態を端末へ保存できません。ブラウザを閉じずに使用してください。');
    };
    const interval = window.setInterval(saveCurrentProgress, 1000);
    const saveWhenLeaving = () => saveCurrentProgress();
    window.addEventListener('pagehide', saveWhenLeaving);
    document.addEventListener('visibilitychange', saveWhenLeaving);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('pagehide', saveWhenLeaving);
      document.removeEventListener('visibilitychange', saveWhenLeaving);
    };
  }, [ready, runner.machineRef]);

  const clearRecovery = () => {
    clearProgress();
    setPendingRecovery(null);
  };

  const selectTimer = (id: string) => {
    const next = timers.find((timer) => timer.id === id);
    if (!next) return;
    clearRecovery();
    setSelectedId(id);
    runner.resetProgressFor(next);
  };

  const saveSettings = (nextTimers: TimerSettings[], nextId: string) => {
    const selected = nextTimers.find((timer) => timer.id === nextId) ?? nextTimers[0];
    if (!selected) return;
    clearRecovery();
    setTimers(nextTimers);
    setSelectedId(selected.id);
    runner.resetProgressFor(selected);
    setSettingsOpen(false);
  };

  const handleTogglePlay = () => {
    const machine = runner.machineRef.current;
    if (!isTimerRunning(machine) && (timerStepIndex(machine) === 0 || machine.type === 'completed')) {
      setPreflightOpen(true);
      return;
    }
    runner.togglePlay();
  };

  const handleReset = () => {
    clearRecovery();
    runner.resetProgressFor(current);
  };

  const requestResetConfirmation = () => {
    const wasPlaying = isTimerRunning(runner.machineRef.current) && !isTimerPaused(runner.machineRef.current);
    if (wasPlaying) runner.pauseTimer();
    setPendingAction({ type: 'reset', wasPlaying });
  };

  const requestJump = (index: number) => {
    if (!isTimerRunning(runner.machineRef.current)) {
      runner.jumpTo(index);
      return;
    }
    const wasPlaying = !isTimerPaused(runner.machineRef.current);
    if (wasPlaying) runner.pauseTimer();
    setPendingAction({ type: 'jump', index, wasPlaying });
  };

  const confirmJumpByHold = (index: number) => {
    const machine = runner.machineRef.current;
    runner.jumpTo(index, isTimerPaused(machine));
  };

  const cancelPendingAction = () => {
    if (pendingAction?.wasPlaying) runner.resumeTimer();
    setPendingAction(null);
  };

  const confirmPendingAction = () => {
    if (!pendingAction) return;
    if (pendingAction.type === 'reset') handleReset();
    else runner.jumpTo(pendingAction.index, !pendingAction.wasPlaying);
    setPendingAction(null);
  };

  const restorePreviousProgress = () => {
    if (!pendingRecovery || !runner.restoreProgress(pendingRecovery)) {
      clearRecovery();
      return;
    }
    setPendingRecovery(null);
  };

  const discardPreviousProgress = () => {
    clearRecovery();
    runner.resetProgressFor(current);
  };

  return (
    <main className="app-shell">
      <TimerScreen
        current={current}
        timers={timers}
        selectedId={selectedId}
        runtime={currentRuntime}
        steps={steps}
        machine={runner.machine}
        estimatedDuration={estimatedDuration}
        settingsButtonRef={settingsButtonRef}
        updateAvailable={updateAvailable}
        onApplyUpdate={applyUpdate}
        onSelectTimer={selectTimer}
        onOpenSettings={() => {
          if (isActive && !isPaused) runner.pauseTimer();
          setSettingsOpen(true);
        }}
        onTogglePlay={handleTogglePlay}
        onReset={handleReset}
        onKeyboardReset={requestResetConfirmation}
        onConfirmedJump={confirmJumpByHold}
        onJump={requestJump}
      />

      {storageWarning && <p className="storage-warning" role="alert">{storageWarning}</p>}
      {settingsOpen && <SettingsModal timers={timers} selectedId={selectedId} voices={voices} returnFocusRef={settingsButtonRef} onClose={() => setSettingsOpen(false)} onSave={saveSettings} />}

      {pendingRecovery && (
        <AccessibleDialog labelledBy="recovery-title" className="compact-modal" closeOnBackdrop={false} closeOnEscape={false}>
          <p className="eyebrow">RECOVERY</p><h2 id="recovery-title">前回の進行が見つかりました</h2>
          <p>保存時点のフェイズと残り時間を、一時停止状態で復元できます。復元後に「再開」を押すまでタイマーは動きません。</p>
          <dl className="preflight-summary"><div><dt>タイマー</dt><dd>{current.common.name}</dd></div><div><dt>保存日時</dt><dd>{pendingRecovery.savedAt ? new Date(pendingRecovery.savedAt).toLocaleString('ja-JP') : '不明'}</dd></div></dl>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={discardPreviousProgress}>破棄して最初から</button><button className="save-button" type="button" onClick={restorePreviousProgress}>前回の進行を再開</button></div>
        </AccessibleDialog>
      )}

      {preflightOpen && (
        <AccessibleDialog labelledBy="preflight-title" className="compact-modal" onClose={() => setPreflightOpen(false)}>
          <p className="eyebrow">PRE-FLIGHT CHECK</p><h2 id="preflight-title">開始前チェック</h2>
          <dl className="preflight-summary">
            <div><dt>タイマー</dt><dd>{current.common.name}</dd></div><div><dt>パック数</dt><dd>{current.common.packCount}パック / 人</dd></div><div><dt>予想所要時間</dt><dd>約 {estimatedDuration}分</dd></div>
          </dl>
          <button className="audio-test-button" type="button" onClick={runner.testSpeech} disabled={!current.common.speech.enabled}>音声をテスト</button>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setPreflightOpen(false)}>キャンセル</button><button className="save-button" type="button" onClick={() => { setPreflightOpen(false); runner.beginRun(0); }}>確認して開始</button></div>
        </AccessibleDialog>
      )}

      {pendingAction && (
        <AccessibleDialog labelledBy="action-title" className="compact-modal" onClose={cancelPendingAction}>
          <p className="eyebrow">CONFIRM</p><h2 id="action-title">{pendingAction.type === 'reset' ? '進行をリセットしますか？' : 'フェイズを移動しますか？'}</h2>
          <p>{pendingAction.type === 'reset' ? '現在の進行状態は削除され、先頭へ戻ります。' : '現在の案内を中断して、選んだフェイズの先頭へ移動します。'}</p>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={cancelPendingAction}>キャンセル</button><button className="danger-confirm" type="button" onClick={confirmPendingAction}>{pendingAction.type === 'reset' ? 'リセット' : '移動する'}</button></div>
        </AccessibleDialog>
      )}
    </main>
  );
}
