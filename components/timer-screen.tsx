'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  directionForPack,
  formatTime,
  phaseGroupLabel,
  type DraftStep,
  type RuntimeSettings,
  type TimerSettings,
} from '@/lib/timer-domain';
import {
  isTimerPaused,
  isTimerRunning,
  timerRemainingMs,
  timerStatusLabel,
  timerStepIndex,
  type TimerMachineState,
} from '@/lib/timer-machine';

function HoldActionButton({
  active,
  children,
  className = '',
  disabled = false,
  onAction,
  onKeyboardConfirm,
}: {
  active: boolean;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onAction: () => void;
  onKeyboardConfirm: () => void;
}) {
  const [holding, setHolding] = useState(false);
  const timerRef = useRef<number | null>(null);
  const completedRef = useRef(false);

  const cancelHold = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setHolding(false);
  };

  useEffect(() => cancelHold, []);

  return (
    <button
      className={`${className} hold-action${holding ? ' holding' : ''}`.trim()}
      type="button"
      disabled={disabled}
      aria-describedby={active ? 'hold-operation-help' : undefined}
      onPointerDown={() => {
        if (!active || disabled) return;
        cancelHold();
        completedRef.current = false;
        setHolding(true);
        timerRef.current = window.setTimeout(() => {
          completedRef.current = true;
          cancelHold();
          onAction();
        }, 800);
      }}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onPointerLeave={cancelHold}
      onClick={(event) => {
        if (completedRef.current) {
          completedRef.current = false;
          return;
        }
        if (!active) onAction();
        else if (event.detail === 0) onKeyboardConfirm();
        completedRef.current = false;
      }}
    >
      {children}
    </button>
  );
}

export function TimerScreen({
  current,
  timers,
  selectedId,
  runtime,
  steps,
  machine,
  estimatedDuration,
  settingsButtonRef,
  updateAvailable,
  onApplyUpdate,
  onSelectTimer,
  onOpenSettings,
  onTogglePlay,
  onReset,
  onKeyboardReset,
  onConfirmedJump,
  onJump,
}: {
  current: TimerSettings;
  timers: TimerSettings[];
  selectedId: string;
  runtime: RuntimeSettings;
  steps: DraftStep[];
  machine: TimerMachineState;
  estimatedDuration: string;
  settingsButtonRef: RefObject<HTMLButtonElement | null>;
  updateAvailable: boolean;
  onApplyUpdate: () => void;
  onSelectTimer: (id: string) => void;
  onOpenSettings: () => void;
  onTogglePlay: () => void;
  onReset: () => void;
  onKeyboardReset: () => void;
  onConfirmedJump: (index: number) => void;
  onJump: (index: number) => void;
}) {
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const currentIndex = timerStepIndex(machine);
  const remainingMs = timerRemainingMs(machine);
  const isActive = isTimerRunning(machine);
  const isPaused = isTimerPaused(machine);
  const status = timerStatusLabel(machine);
  const currentStep = steps[Math.min(currentIndex, steps.length - 1)] ?? steps[0];
  const maxSeconds = Math.max(1, currentStep?.seconds ?? 1);
  const progress = Math.max(0, Math.min(100, (remainingMs / (maxSeconds * 1000)) * 100));
  const stepPack = currentStep?.pack ?? runtime.common.packCount;
  const direction = directionForPack(runtime, stepPack);
  const showPack = currentStep && !['session', 'deck', 'end'].includes(currentStep.kind);
  const showDirection = currentStep && ['pack', 'pick', 'last', 'interval'].includes(currentStep.kind);
  const mainLabel = currentStep?.kind === 'pick' ? currentStep.label : currentStep?.label ?? '準備完了';

  useEffect(() => {
    const handleChange = () => setFullscreen(Boolean(document.fullscreenElement));
    const frame = requestAnimationFrame(() => setFullscreenSupported(Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen)));
    document.addEventListener('fullscreenchange', handleChange);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('fullscreenchange', handleChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Browser UI or device policy can reject fullscreen without affecting the timer.
    }
  };

  return (
    <>
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">DT</div>
        <div className="brand-copy"><p className="eyebrow">DRAFT COMPANION</p><h1>Draft Timer</h1></div>
        <label className="timer-select-label">
          <span>使用するタイマー</span>
          <select value={selectedId} onChange={(event) => onSelectTimer(event.target.value)}>{timers.map((timer) => <option value={timer.id} key={timer.id}>{timer.common.name}</option>)}</select>
        </label>
        <span className="duration-chip desktop-duration-chip">予想 約 {estimatedDuration}分</span>
        {fullscreenSupported && <button className="utility-button" type="button" onClick={toggleFullscreen} aria-pressed={fullscreen}>{fullscreen ? '全画面を終了' : '全画面'}</button>}
        <button ref={settingsButtonRef} className="icon-button" type="button" onClick={onOpenSettings} aria-label="設定を開く">⚙</button>
      </header>

      {updateAvailable && (
        <div className="update-banner" role="status">
          <span>新しいバージョンを利用できます。</span>
          <button type="button" onClick={onApplyUpdate}>更新する</button>
        </div>
      )}

      {fullscreenSupported && <div className="mobile-utility-row"><button type="button" onClick={toggleFullscreen} aria-pressed={fullscreen}>{fullscreen ? '全画面を終了' : '全画面で表示'}</button></div>}

      <div className="timer-layout">
        <aside className="phase-panel" aria-label="フェイズ進行">
          <div className="panel-heading"><h2>フェイズ進行</h2><span className="duration-chip">{currentIndex + 1} / {steps.length}</span></div>
          <ol className="phase-list">
            {steps.map((step, index) => (
              <li key={`${step.kind}-${step.pack ?? 0}-${step.turn ?? 0}`}>
                <button className={index === currentIndex ? 'phase-item current' : index < currentIndex ? 'phase-item passed' : 'phase-item'} onClick={() => onJump(index)} type="button" aria-current={index === currentIndex ? 'step' : undefined}>
                  <span className="phase-pack">{phaseGroupLabel(step)}</span>
                  <span className="phase-copy"><strong>{step.label}</strong><small>{step.meta}</small></span>
                  {index === currentIndex && <span className="now-chip">NOW</span>}
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <section className="timer-stage">
          <div className="mobile-phase-row">
            <span>{currentIndex + 1} / {steps.length}</span><strong>{currentStep?.label}</strong>
            <span className="duration-chip mobile-duration-chip" aria-label={`予想所要時間：約 ${estimatedDuration}分`}>予想 約 {estimatedDuration}分</span>
          </div>
          <div className="session-row">
            <span className={isActive && !isPaused ? 'live-dot pulsing' : 'live-dot'} aria-hidden="true" />
            <span>{current.common.name}</span>
            {showPack && <><span className="session-separator">/</span><span>{stepPack} / {current.common.packCount} パック</span></>}
          </div>

          {showDirection ? <div className="direction-card"><span>回す方向</span><strong>{direction === 'left' ? '左隣へ' : '右隣へ'}</strong><span className="direction-arrow" aria-hidden="true">{direction === 'left' ? '←' : '→'}</span></div> : <div className="direction-spacer" />}

          <div className="timer-content">
            <p className="pick-label">{mainLabel}</p>
            <div className="time-display" aria-label={`残り${formatTime(remainingMs)}`}>{formatTime(remainingMs)}</div>
            <div className="time-track" role="progressbar" aria-label="フェイズの残り時間" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-valuetext={`残り${formatTime(remainingMs)}`}><span style={{ width: `${progress}%` }} /></div>
            <p className={isActive && !isPaused ? 'status-text active' : 'status-text'} role="status">{status}</p>
          </div>

          <div className="primary-actions">
            <button className="play-button" type="button" onClick={onTogglePlay}><span>{isActive && !isPaused ? 'Ⅱ' : '▶'}</span> {isActive && !isPaused ? '一時停止' : isPaused ? '再開' : status === '完了' ? 'もう一度' : '開始'}</button>
            <HoldActionButton active={isActive} className="secondary-button" onAction={onReset} onKeyboardConfirm={onKeyboardReset}>リセット</HoldActionButton>
          </div>

          <div className="navigation-actions" aria-label="フェイズ移動">
            <HoldActionButton active={isActive} disabled={currentIndex === 0} onAction={() => onConfirmedJump(currentIndex - 1)} onKeyboardConfirm={() => onJump(currentIndex - 1)}>← 前のフェイズ</HoldActionButton>
            <HoldActionButton active={isActive} onAction={() => onConfirmedJump(currentIndex)} onKeyboardConfirm={() => onJump(currentIndex)}>このフェイズの先頭へ</HoldActionButton>
            <HoldActionButton active={isActive} disabled={currentIndex >= steps.length - 1} onAction={() => onConfirmedJump(currentIndex + 1)} onKeyboardConfirm={() => onJump(currentIndex + 1)}>次のフェイズ →</HoldActionButton>
          </div>
          {isActive && <p id="hold-operation-help" className="operation-help">進行中：リセットと「前／先頭／次」の操作は0.8秒長押し</p>}
        </section>
      </div>
    </>
  );
}
