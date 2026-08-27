'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type CountType = 'fixed' | 'perCard' | 'step';
type DirectionMode = 'alternate' | 'fixed';
type Direction = 'left' | 'right';
type StepKind = 'session' | 'pack' | 'pick' | 'last' | 'interval' | 'deck' | 'end';

type TimerSettings = {
  id: string;
  name: string;
  packCount: number;
  cardCount: number;
  cardsPerPick: number;
  packIntervals: number[];
  deckBuildSeconds: number;
  countType: CountType;
  fixedSeconds: number;
  perCardSeconds: number[];
  baseSeconds: number;
  stepDecrease: number;
  directionMode: DirectionMode;
  initialDirection: Direction;
  speechEnabled: boolean;
  speechVoice: string;
  speechRate: number;
  speechVolume: number;
};

type DraftStep = {
  kind: StepKind;
  pack?: number;
  turn?: number;
  seconds: number;
  label: string;
  meta: string;
};

const STORAGE_KEY = 'drafttimer:web:v1';
const defaultPerCard = [40, 40, 35, 30, 25, 25, 20, 20, 15, 10, 10, 5, 5, 5];
const defaultTimer: TimerSettings = {
  id: 'standard-draft',
  name: 'Standard Draft',
  packCount: 3,
  cardCount: 15,
  cardsPerPick: 1,
  packIntervals: [60, 60],
  deckBuildSeconds: 1200,
  countType: 'perCard',
  fixedSeconds: 40,
  perCardSeconds: defaultPerCard,
  baseSeconds: 0,
  stepDecrease: 3,
  directionMode: 'alternate',
  initialDirection: 'left',
  speechEnabled: true,
  speechVoice: '',
  speechRate: 1,
  speechVolume: 1,
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

function turnCount(settings: TimerSettings) {
  return Math.max(1, Math.ceil(Math.max(1, settings.cardCount) / Math.max(1, settings.cardsPerPick)));
}

function remainingCards(settings: TimerSettings, turn: number) {
  return Math.max(1, settings.cardCount - (turn - 1) * settings.cardsPerPick);
}

function pickRange(settings: TimerSettings, turn: number) {
  const start = (turn - 1) * settings.cardsPerPick + 1;
  const end = Math.min(start + settings.cardsPerPick - 1, settings.cardCount);
  return start === end ? `${start}枚目` : `${start}〜${end}枚目`;
}

function turnSeconds(settings: TimerSettings, turn: number) {
  if (settings.countType === 'fixed') return Math.max(0, settings.fixedSeconds);
  if (settings.countType === 'step') {
    return Math.max(0, settings.baseSeconds + settings.stepDecrease * (remainingCards(settings, turn) - 1));
  }
  return Math.max(0, settings.perCardSeconds[turn - 1] ?? settings.perCardSeconds.at(-1) ?? 10);
}

function directionForPack(settings: TimerSettings, pack: number): Direction {
  if (settings.directionMode === 'fixed' || pack % 2 === 1) return settings.initialDirection;
  return settings.initialDirection === 'left' ? 'right' : 'left';
}

function buildSteps(settings: TimerSettings): DraftStep[] {
  const result: DraftStep[] = [{ kind: 'session', seconds: 0, label: 'セッション開始', meta: '音声案内' }];
  const turns = turnCount(settings);
  for (let pack = 1; pack <= settings.packCount; pack += 1) {
    result.push({ kind: 'pack', pack, seconds: 0, label: `${pack}パック目を開始`, meta: 'パックを開封' });
    for (let turn = 1; turn <= turns; turn += 1) {
      const range = pickRange(settings, turn);
      const remaining = remainingCards(settings, turn);
      if (turn === turns) {
        result.push({ kind: 'last', pack, turn, seconds: 0, label: `最後のカード`, meta: `${range}・そのまま受け取る` });
      } else {
        const seconds = turnSeconds(settings, turn);
        result.push({ kind: 'pick', pack, turn, seconds, label: `${range}（${remaining}枚残）`, meta: `${seconds}秒` });
      }
    }
    if (pack < settings.packCount) {
      const seconds = Math.max(0, settings.packIntervals[pack - 1] ?? 0);
      if (seconds > 0) result.push({ kind: 'interval', pack, seconds, label: `パック${pack}後の休憩`, meta: `${seconds}秒` });
    }
  }
  if (settings.deckBuildSeconds > 0) {
    result.push({ kind: 'deck', seconds: settings.deckBuildSeconds, label: 'デッキ構築', meta: `${Math.ceil(settings.deckBuildSeconds / 60)}分` });
  }
  result.push({ kind: 'end', seconds: 0, label: 'ドラフト終了', meta: '音声案内' });
  return result;
}

function estimateMinutes(settings: TimerSettings) {
  const countdown = buildSteps(settings).reduce((sum, step) => sum + step.seconds, 0);
  const spokenSteps = buildSteps(settings).length * 2.4;
  const padding = Math.max(0, buildSteps(settings).length - 2) * 2;
  return Math.max(1, Math.ceil((countdown + spokenSteps + padding) / 60));
}

function formatTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function initialDisplaySeconds(settings: TimerSettings, step?: DraftStep) {
  if (!step) return 0;
  if (step.kind === 'session' || step.kind === 'pack') return turnSeconds(settings, 1);
  return step.seconds;
}

function phaseGroupLabel(step: DraftStep) {
  if (step.pack) return `${step.pack}パック`;
  if (step.kind === 'session') return '開始';
  if (step.kind === 'deck') return '構築';
  return '終了';
}

function normalizeTimer(raw: Partial<TimerSettings>): TimerSettings {
  const merged = { ...defaultTimer, ...raw };
  return {
    ...merged,
    id: String(merged.id || crypto.randomUUID()),
    name: String(merged.name || '新しいタイマー').slice(0, 30),
    packCount: clamp(Number(merged.packCount), 1, 10),
    cardCount: clamp(Number(merged.cardCount), 2, 30),
    cardsPerPick: clamp(Number(merged.cardsPerPick), 1, 5),
    packIntervals: Array.isArray(merged.packIntervals) ? merged.packIntervals.map((value) => clamp(Number(value), 0, 3600)) : [60, 60],
    deckBuildSeconds: clamp(Number(merged.deckBuildSeconds), 0, 7200),
    fixedSeconds: clamp(Number(merged.fixedSeconds), 1, 3600),
    perCardSeconds: Array.isArray(merged.perCardSeconds) ? merged.perCardSeconds.map((value) => clamp(Number(value), 1, 3600)) : defaultPerCard,
    baseSeconds: clamp(Number(merged.baseSeconds), 0, 3600),
    stepDecrease: clamp(Number(merged.stepDecrease), 1, 300),
    speechRate: clamp(Number(merged.speechRate), 0.5, 2),
    speechVolume: clamp(Number(merged.speechVolume), 0, 1),
  };
}

export default function Home() {
  const [timers, setTimers] = useState<TimerSettings[]>([defaultTimer]);
  const [selectedId, setSelectedId] = useState(defaultTimer.id);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<TimerSettings>(defaultTimer);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [ready, setReady] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [remainingMs, setRemainingMs] = useState(turnSeconds(defaultTimer, 1) * 1000);
  const [isActive, setIsActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [status, setStatus] = useState('停止中');

  const current = timers.find((timer) => timer.id === selectedId) ?? timers[0] ?? defaultTimer;
  const steps = useMemo(() => buildSteps(current), [current]);
  const currentStep = steps[Math.min(currentIndex, steps.length - 1)] ?? steps[0];
  const maxSeconds = Math.max(1, currentStep?.seconds ?? 1);
  const progress = Math.max(0, Math.min(100, (remainingMs / (maxSeconds * 1000)) * 100));

  const currentIndexRef = useRef(0);
  const runRef = useRef({ token: 0, active: false, paused: false });
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { timers?: Partial<TimerSettings>[]; selectedId?: string };
        const restored = parsed.timers?.map(normalizeTimer).filter((timer) => timer.name) ?? [];
        if (restored.length) {
          setTimers(restored);
          const nextId = restored.some((timer) => timer.id === parsed.selectedId) ? parsed.selectedId! : restored[0].id;
          setSelectedId(nextId);
          const selected = restored.find((timer) => timer.id === nextId) ?? restored[0];
          setDraft(selected);
          setRemainingMs(initialDisplaySeconds(selected, buildSteps(selected)[0]) * 1000);
        }
      }
    } catch {
      // 壊れた端末内データは初期値で安全に復旧する。
    }
    setReady(true);
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ timers, selectedId }));
  }, [ready, selectedId, timers]);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
  }, []);

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

  useEffect(() => {
    const pauseWhenHidden = () => {
      if (document.hidden && runRef.current.active && !runRef.current.paused) pauseTimer();
    };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden);
  });

  const setStep = (index: number, sourceSteps = steps, sourceSettings = current) => {
    const bounded = clamp(index, 0, Math.max(0, sourceSteps.length - 1));
    currentIndexRef.current = bounded;
    setCurrentIndex(bounded);
    setRemainingMs(initialDisplaySeconds(sourceSettings, sourceSteps[bounded]) * 1000);
  };

  const stopSpeech = () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  };

  const halt = () => {
    runRef.current.token += 1;
    runRef.current.active = false;
    runRef.current.paused = false;
    stopSpeech();
    setIsActive(false);
    setIsPaused(false);
  };

  const waitForResume = async (token: number) => {
    while (runRef.current.token === token && runRef.current.active && runRef.current.paused) {
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    if (runRef.current.token !== token || !runRef.current.active) throw new Error('cancelled');
  };

  const sleepPausable = async (milliseconds: number, token: number) => {
    let left = milliseconds;
    let previous = performance.now();
    while (left > 0) {
      await waitForResume(token);
      await new Promise((resolve) => setTimeout(resolve, Math.min(80, left)));
      if (runRef.current.token !== token || !runRef.current.active) throw new Error('cancelled');
      const now = performance.now();
      if (!runRef.current.paused) left -= now - previous;
      previous = now;
    }
  };

  const speakOnce = (text: string, settings: TimerSettings) =>
    new Promise<'ended' | 'cancelled'>((resolve) => {
      if (!settings.speechEnabled || !('speechSynthesis' in window)) {
        resolve('ended');
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = window.speechSynthesis.getVoices().find((item) => item.name === settings.speechVoice);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || 'ja-JP';
      utterance.rate = settings.speechRate;
      utterance.volume = settings.speechVolume;
      utterance.onend = () => resolve('ended');
      utterance.onerror = () => resolve('cancelled');
      window.speechSynthesis.speak(utterance);
    });

  const speakPausable = async (text: string, settings: TimerSettings, token: number) => {
    if (!settings.speechEnabled) return;
    while (runRef.current.token === token && runRef.current.active) {
      await waitForResume(token);
      const result = await speakOnce(text, settings);
      if (result === 'ended') return;
      if (!runRef.current.paused) throw new Error('cancelled');
    }
  };

  const announceNumber = (text: string, settings: TimerSettings) => {
    if (!settings.speechEnabled || !('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = window.speechSynthesis.getVoices().find((item) => item.name === settings.speechVoice);
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || 'ja-JP';
    utterance.rate = settings.speechRate;
    utterance.volume = settings.speechVolume;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const countdown = async (seconds: number, settings: TimerSettings, token: number) => {
    let left = seconds * 1000;
    let previous = performance.now();
    let lastSpoken = Math.ceil(seconds);
    setRemainingMs(left);
    while (left > 0) {
      await waitForResume(token);
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (runRef.current.token !== token || !runRef.current.active) throw new Error('cancelled');
      const now = performance.now();
      if (!runRef.current.paused) left = Math.max(0, left - (now - previous));
      previous = now;
      setRemainingMs(left);
      const whole = Math.ceil(left / 1000);
      if (whole !== lastSpoken) {
        lastSpoken = whole;
        if (whole > 30 && whole % 60 === 0) {
          announceNumber(`残り${whole / 60}分です`, settings);
        } else if (whole > 0 && whole <= 30 && whole % 10 === 0) {
          announceNumber(`残り${whole}秒です`, settings);
        }
        if (whole === 3 || whole === 2 || whole === 1) {
          announceNumber(String(whole), settings);
        }
      }
    }
    setRemainingMs(0);
  };

  const executeStep = async (step: DraftStep, settings: TimerSettings, token: number) => {
    const direction = directionForPack(settings, step.pack ?? 1) === 'left' ? '左' : '右';
    if (step.kind === 'session') {
      setStatus('開始案内中');
      await speakPausable(`これより、ドラフトの音声案内を開始します。このドラフトでは、1パック${settings.cardCount}枚、一人当たり${settings.packCount}パック使用します。`, settings, token);
      await sleepPausable(2000, token);
    } else if (step.kind === 'pack') {
      setStatus('パック開始案内中');
      await speakPausable(`${step.pack}パック目のピックを開始します。パックを開封してください。`, settings, token);
      await sleepPausable(2000, token);
    } else if (step.kind === 'pick') {
      setStatus('ピック開始案内中');
      await speakPausable(`${pickRange(settings, step.turn ?? 1)}、制限時間${step.seconds}秒です、ピックアップ！`, settings, token);
      setStatus('カウント中');
      await countdown(step.seconds, settings, token);
      stopSpeech();
      setStatus('カードを回してください');
      await speakPausable(`ドラフト！${direction}隣にまわしてください`, settings, token);
      await sleepPausable(2000, token);
    } else if (step.kind === 'last') {
      setStatus('最後のカード');
      await speakPausable('最後のカードはそのまま受け取ってください', settings, token);
    } else if (step.kind === 'interval') {
      setStatus('インターバル開始案内中');
      await speakPausable(`インターバルを開始します。制限時間${step.seconds}秒です。スタート！`, settings, token);
      setStatus('インターバル中');
      await countdown(step.seconds, settings, token);
      stopSpeech();
      await speakPausable('インターバル終了', settings, token);
      await sleepPausable(2000, token);
    } else if (step.kind === 'deck') {
      const minutes = Math.ceil(step.seconds / 60);
      setStatus('デッキ構築開始案内中');
      await speakPausable(`デッキ構築を開始します。制限時間${minutes}分です。スタート！`, settings, token);
      setStatus('デッキ構築中');
      await countdown(step.seconds, settings, token);
      stopSpeech();
      await speakPausable('デッキ構築の時間が終了しました', settings, token);
      await sleepPausable(2000, token);
    } else {
      setStatus('終了案内中');
      await speakPausable('ドラフトのピックが終了しました', settings, token);
      await speakPausable('以上で、音声案内を終了します。', settings, token);
    }
  };

  const beginRun = (startIndex = currentIndexRef.current) => {
    const token = runRef.current.token + 1;
    const settingsSnapshot = { ...current, packIntervals: [...current.packIntervals], perCardSeconds: [...current.perCardSeconds] };
    const sequence = buildSteps(settingsSnapshot);
    runRef.current = { token, active: true, paused: false };
    setIsActive(true);
    setIsPaused(false);

    void (async () => {
      try {
        for (let index = startIndex; index < sequence.length; index += 1) {
          await waitForResume(token);
          setStep(index, sequence, settingsSnapshot);
          await executeStep(sequence[index], settingsSnapshot, token);
        }
        if (runRef.current.token === token) {
          runRef.current.active = false;
          setIsActive(false);
          setStatus('完了');
        }
      } catch {
        // リセットやフェイズ移動による中断は正常な状態遷移。
      }
    })();
  };

  const pauseTimer = () => {
    if (!runRef.current.active) return;
    runRef.current.paused = true;
    stopSpeech();
    setIsPaused(true);
    setStatus('一時停止中');
  };

  const togglePlay = () => {
    if (runRef.current.active && !runRef.current.paused) {
      pauseTimer();
      return;
    }
    if (runRef.current.active && runRef.current.paused) {
      runRef.current.paused = false;
      setIsPaused(false);
      setStatus('再開中');
      return;
    }
    if (status === '完了') setStep(0);
    beginRun(status === '完了' ? 0 : currentIndexRef.current);
  };

  const resetTimer = () => {
    halt();
    setStep(0);
    setStatus('停止中');
  };

  const jumpTo = (index: number) => {
    const restart = runRef.current.active;
    halt();
    setStep(index);
    setStatus('停止中');
    if (restart) beginRun(index);
  };

  const openSettings = () => {
    if (runRef.current.active && !runRef.current.paused) pauseTimer();
    setDraft({ ...current, packIntervals: [...current.packIntervals], perCardSeconds: [...current.perCardSeconds] });
    setSettingsOpen(true);
  };

  const saveSettings = () => {
    const normalized = normalizeTimer(draft);
    setTimers((items) => items.map((item) => item.id === normalized.id ? normalized : item));
    setSelectedId(normalized.id);
    halt();
    const nextSteps = buildSteps(normalized);
    setStep(0, nextSteps, normalized);
    setStatus('停止中');
    setSettingsOpen(false);
  };

  const selectTimer = (id: string) => {
    const next = timers.find((timer) => timer.id === id);
    if (!next) return;
    halt();
    setSelectedId(id);
    setDraft(next);
    setStep(0, buildSteps(next), next);
    setStatus('停止中');
  };

  const addTimer = () => {
    const copy = normalizeTimer({ ...defaultTimer, id: crypto.randomUUID(), name: `新しいタイマー ${timers.length + 1}` });
    setTimers((items) => [...items, copy]);
    setSelectedId(copy.id);
    setDraft(copy);
  };

  const copyTimer = () => {
    const copy = normalizeTimer({ ...draft, id: crypto.randomUUID(), name: `${draft.name} のコピー`.slice(0, 30) });
    setTimers((items) => [...items, copy]);
    setSelectedId(copy.id);
    setDraft(copy);
  };

  const deleteTimer = () => {
    if (timers.length <= 1 || !window.confirm(`「${draft.name}」を削除しますか？`)) return;
    const next = timers.filter((timer) => timer.id !== draft.id);
    const selected = next[0];
    setTimers(next);
    setSelectedId(selected.id);
    setDraft(selected);
    halt();
    setStep(0, buildSteps(selected), selected);
  };

  const updateDraft = <K extends keyof TimerSettings>(key: K, value: TimerSettings[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const stepPack = currentStep?.pack ?? Math.min(current.packCount, Math.max(1, current.packCount));
  const direction = directionForPack(current, stepPack);
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
            {timers.map((timer) => <option value={timer.id} key={timer.id}>{timer.name}</option>)}
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
            <span>{current.name}</span>
            {showPack && <><span className="session-separator">/</span><span>{stepPack} / {current.packCount} パック</span></>}
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

            <div className="settings-toolbar">
              <label><span>編集するタイマー</span><select value={draft.id} onChange={(event) => { const timer = timers.find((item) => item.id === event.target.value); if (timer) { setDraft(timer); setSelectedId(timer.id); } }}>{timers.map((timer) => <option value={timer.id} key={timer.id}>{timer.name}</option>)}</select></label>
              <div className="compact-actions"><button type="button" onClick={addTimer}>＋ 新規</button><button type="button" onClick={copyTimer}>複製</button><button className="danger" type="button" onClick={deleteTimer} disabled={timers.length <= 1}>削除</button></div>
            </div>

            <div className="settings-grid">
              <div className="settings-column">
                <fieldset className="settings-card">
                  <legend>基本設定</legend>
                  <label className="field full"><span>タイマー名</span><input value={draft.name} maxLength={30} onChange={(event) => updateDraft('name', event.target.value)} /></label>
                  <div className="field-row">
                    <label className="field"><span>パック数 / 人</span><NumberSelect value={draft.packCount} options={packCountOptions} onChange={(value) => updateDraft('packCount', value)} format={(value) => `${value}パック`} /></label>
                    <label className="field"><span>カード枚数 / パック</span><NumberSelect value={draft.cardCount} options={cardCountOptions} onChange={(value) => updateDraft('cardCount', value)} format={(value) => `${value}枚`} /></label>
                  </div>
                  <div className="field-row">
                    <label className="field"><span>1ピックの獲得枚数</span><NumberSelect value={draft.cardsPerPick} options={cardsPerPickOptions} onChange={(value) => updateDraft('cardsPerPick', value)} format={(value) => `${value}枚`} /></label>
                    <label className="field"><span>デッキ構築時間</span><NumberSelect value={Math.round(draft.deckBuildSeconds / 60)} options={deckBuildMinuteOptions} onChange={(value) => updateDraft('deckBuildSeconds', value * 60)} format={(value) => value === 0 ? 'なし' : `${value}分`} /></label>
                  </div>
                </fieldset>

                {draft.packCount > 1 && <fieldset className="settings-card"><legend>パック間インターバル</legend><div className="interval-grid">{Array.from({ length: draft.packCount - 1 }, (_, index) => <label className="field" key={index}><span>{index + 1} → {index + 2} パック</span><NumberSelect value={draft.packIntervals[index] ?? 60} options={nonNegativeSecondOptions} onChange={(value) => { const next = [...draft.packIntervals]; next[index] = value; updateDraft('packIntervals', next); }} format={(value) => value === 0 ? 'なし' : value >= 60 && value % 60 === 0 ? `${value}秒（${value / 60}分）` : `${value}秒`} /></label>)}</div></fieldset>}

                <fieldset className="settings-card">
                  <legend>回す方向</legend>
                  <div className="segmented"><button type="button" className={draft.directionMode === 'alternate' ? 'selected' : ''} onClick={() => updateDraft('directionMode', 'alternate')}>パックごとに交互</button><button type="button" className={draft.directionMode === 'fixed' ? 'selected' : ''} onClick={() => updateDraft('directionMode', 'fixed')}>固定</button></div>
                  <div className="segmented compact"><button type="button" className={draft.initialDirection === 'left' ? 'selected' : ''} onClick={() => updateDraft('initialDirection', 'left')}>← 左から開始</button><button type="button" className={draft.initialDirection === 'right' ? 'selected' : ''} onClick={() => updateDraft('initialDirection', 'right')}>右から開始 →</button></div>
                  <p className="preview-line">{Array.from({ length: Math.min(3, draft.packCount) }, (_, index) => `${index + 1}P: ${directionForPack(draft, index + 1) === 'left' ? '左' : '右'}`).join('　')}</p>
                </fieldset>
              </div>

              <div className="settings-column">
                <fieldset className="settings-card">
                  <legend>カウント方式</legend>
                  <div className="segmented three"><button type="button" className={draft.countType === 'fixed' ? 'selected' : ''} onClick={() => updateDraft('countType', 'fixed')}>固定</button><button type="button" className={draft.countType === 'perCard' ? 'selected' : ''} onClick={() => updateDraft('countType', 'perCard')}>個別</button><button type="button" className={draft.countType === 'step' ? 'selected' : ''} onClick={() => updateDraft('countType', 'step')}>階段</button></div>
                  {draft.countType === 'fixed' && <label className="field full"><span>1ピックの時間</span><NumberSelect value={draft.fixedSeconds} options={secondOptions} onChange={(value) => updateDraft('fixedSeconds', value)} format={(value) => `${value}秒`} /></label>}
                  {draft.countType === 'step' && <><div className="field-row"><label className="field"><span>下駄秒数</span><NumberSelect value={draft.baseSeconds} options={nonNegativeSecondOptions} onChange={(value) => updateDraft('baseSeconds', value)} format={(value) => `${value}秒`} /></label><label className="field"><span>1枚ごとの減少量</span><NumberSelect value={draft.stepDecrease} options={stepDecreaseOptions} onChange={(value) => updateDraft('stepDecrease', value)} format={(value) => `${value}秒`} /></label></div><p className="preview-line">1ピック目 {turnSeconds(draft, 1)}秒 → 2ピック目 {turnSeconds(draft, 2)}秒 → 3ピック目 {turnSeconds(draft, 3)}秒</p></>}
                  {draft.countType === 'perCard' && <div className="per-card-grid">{Array.from({ length: Math.max(1, turnCount(draft) - 1) }, (_, index) => <label className="mini-field" key={index}><span>{pickRange(draft, index + 1)}</span><NumberSelect value={draft.perCardSeconds[index] ?? defaultPerCard[index] ?? 10} options={secondOptions} onChange={(value) => { const next = [...draft.perCardSeconds]; next[index] = value; updateDraft('perCardSeconds', next); }} format={(value) => `${value}秒`} /></label>)}</div>}
                </fieldset>

                <fieldset className="settings-card">
                  <legend>音声案内</legend>
                  <label className="toggle-field"><input type="checkbox" checked={draft.speechEnabled} onChange={(event) => updateDraft('speechEnabled', event.target.checked)} /><span>ブラウザの音声で案内する</span></label>
                  <label className="field full"><span>音声</span><select value={draft.speechVoice} onChange={(event) => updateDraft('speechVoice', event.target.value)}><option value="">端末の標準音声</option>{voices.filter((voice) => voice.lang.startsWith('ja')).map((voice) => <option value={voice.name} key={voice.name}>{voice.name}</option>)}</select></label>
                  <div className="field-row"><label className="field"><span>読み上げ速度</span><NumberSelect value={draft.speechRate} options={speechRateOptions} onChange={(value) => updateDraft('speechRate', value)} format={(value) => `${value.toFixed(1)}×`} /></label><label className="field"><span>音量</span><NumberSelect value={draft.speechVolume} options={speechVolumeOptions} onChange={(value) => updateDraft('speechVolume', value)} format={(value) => `${Math.round(value * 100)}%`} /></label></div>
                </fieldset>

                <aside className="install-note"><strong>iPhone / iPad でアプリのように使う</strong><p>Safariの共有ボタンから「ホーム画面に追加」を選んでください。2回目以降はホーム画面から起動でき、設定はこの端末内に保存されます。</p></aside>
              </div>
            </div>

            <footer className="settings-footer"><span>予想所要時間：約 {estimateMinutes(draft)}分</span><div><button className="secondary-button" type="button" onClick={() => setSettingsOpen(false)}>キャンセル</button><button className="save-button" type="button" onClick={saveSettings} disabled={!draft.name.trim()}>保存して閉じる</button></div></footer>
          </section>
        </div>
      )}
    </main>
  );
}
