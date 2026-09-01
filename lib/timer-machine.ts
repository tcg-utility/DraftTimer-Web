export type AnnouncementKind =
  | 'sessionStart'
  | 'packStart'
  | 'pickStart'
  | 'lastPick'
  | 'intervalStart'
  | 'intervalEnd'
  | 'deckStart'
  | 'deckEnd'
  | 'sessionEnd';

export type CountdownKind = 'pick' | 'interval' | 'deck';

type MachineBase = {
  runId: number;
  stepIndex: number;
  remainingMs: number;
};

export type ActiveTimerState =
  | (MachineBase & {
      type: 'announcing';
      announcement: AnnouncementKind;
      announcementLabel?: string;
    })
  | (MachineBase & {
      type: 'counting';
      countdown: CountdownKind;
    })
  | (MachineBase & {
      type: 'passGuidance';
    });

export type TimerMachineState =
  | (MachineBase & { type: 'idle' })
  | ActiveTimerState
  | {
      type: 'paused';
      runId: number;
      suspended: ActiveTimerState;
    }
  | (MachineBase & { type: 'completed' });

export type TimerMachineEvent =
  | (MachineBase & { type: 'RESET' })
  | {
      type: 'START_RUN';
      runId: number;
      initial: ActiveTimerState;
      paused: boolean;
    }
  | (MachineBase & {
      type: 'ENTER_ANNOUNCEMENT';
      announcement: AnnouncementKind;
      announcementLabel?: string;
    })
  | (MachineBase & {
      type: 'ENTER_COUNTDOWN';
      countdown: CountdownKind;
    })
  | (MachineBase & { type: 'ENTER_PASS_GUIDANCE' })
  | { type: 'TICK'; runId: number; remainingMs: number }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | (MachineBase & { type: 'COMPLETE' });

export function createIdleTimerState(remainingMs: number, stepIndex = 0): TimerMachineState {
  return { type: 'idle', runId: 0, stepIndex, remainingMs };
}

function isCurrentRun(state: TimerMachineState, runId: number) {
  return state.runId === runId;
}

export function transitionTimerState(state: TimerMachineState, event: TimerMachineEvent): TimerMachineState {
  switch (event.type) {
    case 'RESET':
      return {
        type: 'idle',
        runId: event.runId,
        stepIndex: event.stepIndex,
        remainingMs: event.remainingMs,
      };

    case 'START_RUN':
      if (event.runId !== event.initial.runId) return state;
      return event.paused
        ? { type: 'paused', runId: event.runId, suspended: event.initial }
        : event.initial;

    case 'ENTER_ANNOUNCEMENT':
      if (!isCurrentRun(state, event.runId) || state.type === 'paused') return state;
      return {
        type: 'announcing',
        runId: event.runId,
        stepIndex: event.stepIndex,
        remainingMs: event.remainingMs,
        announcement: event.announcement,
        announcementLabel: event.announcementLabel,
      };

    case 'ENTER_COUNTDOWN':
      if (!isCurrentRun(state, event.runId) || state.type === 'paused') return state;
      return {
        type: 'counting',
        runId: event.runId,
        stepIndex: event.stepIndex,
        remainingMs: event.remainingMs,
        countdown: event.countdown,
      };

    case 'ENTER_PASS_GUIDANCE':
      if (!isCurrentRun(state, event.runId) || state.type === 'paused') return state;
      return {
        type: 'passGuidance',
        runId: event.runId,
        stepIndex: event.stepIndex,
        remainingMs: event.remainingMs,
      };

    case 'TICK':
      if (!isCurrentRun(state, event.runId) || state.type !== 'counting') return state;
      return { ...state, remainingMs: Math.max(0, event.remainingMs) };

    case 'PAUSE':
      if (!isActiveTimerState(state)) return state;
      return { type: 'paused', runId: state.runId, suspended: state };

    case 'RESUME':
      return state.type === 'paused' ? state.suspended : state;

    case 'COMPLETE':
      if (!isCurrentRun(state, event.runId)) return state;
      return {
        type: 'completed',
        runId: event.runId,
        stepIndex: event.stepIndex,
        remainingMs: event.remainingMs,
      };
  }
}

export function isActiveTimerState(state: TimerMachineState): state is ActiveTimerState {
  return state.type === 'announcing' || state.type === 'counting' || state.type === 'passGuidance';
}

export function isTimerRunning(state: TimerMachineState) {
  return isActiveTimerState(state) || state.type === 'paused';
}

export function isTimerPaused(state: TimerMachineState) {
  return state.type === 'paused';
}

function visibleState(state: TimerMachineState): Exclude<TimerMachineState, { type: 'paused' }> {
  return state.type === 'paused' ? state.suspended : state;
}

export function timerStepIndex(state: TimerMachineState) {
  return visibleState(state).stepIndex;
}

export function timerRemainingMs(state: TimerMachineState) {
  return visibleState(state).remainingMs;
}

export function timerStatusLabel(state: TimerMachineState) {
  if (state.type === 'idle') return '停止中';
  if (state.type === 'paused') return '一時停止中';
  if (state.type === 'completed') return '完了';
  if (state.type === 'passGuidance') return 'カードを回してください';
  if (state.type === 'counting') {
    if (state.countdown === 'interval') return 'インターバル中';
    if (state.countdown === 'deck') return 'デッキ構築中';
    return 'カウント中';
  }

  if (state.announcement === 'sessionStart') return '開始案内中';
  if (state.announcement === 'packStart') return 'パック開始案内中';
  if (state.announcement === 'pickStart') return 'ピック開始案内中';
  if (state.announcement === 'lastPick') return state.announcementLabel ?? '最後のカード';
  if (state.announcement === 'intervalStart') return 'インターバル開始案内中';
  if (state.announcement === 'intervalEnd') return 'インターバル中';
  if (state.announcement === 'deckStart') return 'デッキ構築開始案内中';
  if (state.announcement === 'deckEnd') return 'デッキ構築中';
  return '終了案内中';
}
