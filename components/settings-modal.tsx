'use client';

import { type ChangeEvent, type KeyboardEvent, type RefObject, useMemo, useRef, useState } from 'react';
import { AccessibleDialog } from '@/components/accessible-dialog';
import { estimateMinutes } from '@/lib/duration-estimator';
import {
  BACKUP_FORMAT,
  DATA_VERSION,
  MAX_BACKUP_BYTES,
  cardCountOptions,
  cardsPerPickOptions,
  clamp,
  cloneCommonSettings,
  cloneCountSettings,
  clonePackRule,
  cloneTimer,
  countSettingsForType,
  countTypeLabel,
  deckBuildMinuteOptions,
  defaultPerCard,
  defaultTimer,
  nonNegativeSecondOptions,
  normalizeTimer,
  normalizeTimerCollection,
  numberRange,
  packCountOptions,
  parseSettingsBackup,
  pickRange,
  secondOptions,
  sharedDirectionForPack,
  sharedPackRule,
  speechRateOptions,
  speechVolumeOptions,
  stepDecreaseOptions,
  timedTurnCount,
  turnSeconds,
  buildPickPhasePreview,
  type CountSettings,
  type PackRule,
  type SettingsMode,
  type SharedPackRule,
  type SpeechSettings,
  type TimerCommonSettings,
  type TimerSettings,
} from '@/lib/timer-domain';

function NumberSelect({ value, options, onChange, format = String }: { value: number; options: number[]; onChange: (value: number) => void; format?: (value: number) => string }) {
  const choices = Array.from(new Set([...options, value])).sort((a, b) => a - b);
  return <select value={value} onChange={(event) => onChange(Number(event.target.value))}>{choices.map((option) => <option value={option} key={option}>{format(option)}</option>)}</select>;
}

function TakeLimitFields({
  cardCount,
  takeAll,
  takeCount,
  onChange,
}: {
  cardCount: number;
  takeAll: boolean;
  takeCount: number;
  onChange: (patch: { takeAll?: boolean; takeCount?: number }) => void;
}) {
  const boundedTakeCount = clamp(takeCount, 1, cardCount - 1);
  return (
    <div className="take-limit-row">
      <label className="toggle-field take-all-toggle">
        <input type="checkbox" checked={takeAll} onChange={(event) => onChange({ takeAll: event.target.checked })} />
        <span>全て取る</span>
      </label>
      {!takeAll && (
        <label className="field">
          <span>取得枚数</span>
          <NumberSelect value={boundedTakeCount} options={numberRange(1, cardCount - 1)} onChange={(value) => onChange({ takeCount: value })} format={(value) => `${value}枚`} />
        </label>
      )}
    </div>
  );
}

function PickPhasePreviewList({ rule }: { rule: PackRule }) {
  const phases = buildPickPhasePreview(rule);
  return (
    <section className="pick-preview" aria-label="ピック時間プレビュー">
      <div className="pick-preview-heading"><strong>ピック時間プレビュー</strong><span>実際の進行順</span></div>
      <ol>{phases.map((phase) => (
        <li className={phase.finalCards !== null ? 'final' : ''} key={phase.turn}>
          <span>{phase.finalCards === 1 ? '最後のカード' : phase.finalCards !== null ? `最後の${phase.finalCards}枚` : `${phase.turn}ピック目`}</span>
          <small>{phase.label}</small><strong>{phase.seconds === null ? 'カウントなし' : `${phase.seconds}秒`}</strong>
        </li>
      ))}</ol>
    </section>
  );
}

function CountSettingsFields({ rule, onChange }: { rule: PackRule; onChange: (count: CountSettings) => void }) {
  const timedTurns = timedTurnCount(rule);
  const perCardSeconds = rule.count.type === 'perCard' ? rule.count.seconds : [];
  return <>
    <div className="segmented three" role="group" aria-label="カウント方式">
      <button type="button" className={rule.count.type === 'fixed' ? 'selected' : ''} aria-pressed={rule.count.type === 'fixed'} onClick={() => onChange(countSettingsForType('fixed', rule.count, rule))}>固定</button>
      <button type="button" className={rule.count.type === 'perCard' ? 'selected' : ''} aria-pressed={rule.count.type === 'perCard'} onClick={() => onChange(countSettingsForType('perCard', rule.count, rule))}>個別</button>
      <button type="button" className={rule.count.type === 'step' ? 'selected' : ''} aria-pressed={rule.count.type === 'step'} onClick={() => onChange(countSettingsForType('step', rule.count, rule))}>階段</button>
    </div>
    {rule.count.type === 'fixed' && <label className="field full"><span>1ピックの時間</span><NumberSelect value={rule.count.seconds} options={secondOptions} onChange={(value) => onChange({ type: 'fixed', seconds: value })} format={(value) => `${value}秒`} /></label>}
    {rule.count.type === 'step' && <>
      <div className="field-row">
        <label className="field"><span>下駄秒数</span><NumberSelect value={rule.count.baseSeconds} options={nonNegativeSecondOptions} onChange={(value) => onChange({ type: 'step', baseSeconds: value, decreaseSeconds: rule.count.type === 'step' ? rule.count.decreaseSeconds : 3 })} format={(value) => `${value}秒`} /></label>
        <label className="field"><span>1枚ごとの減少量</span><NumberSelect value={rule.count.decreaseSeconds} options={stepDecreaseOptions} onChange={(value) => onChange({ type: 'step', baseSeconds: rule.count.type === 'step' ? rule.count.baseSeconds : 0, decreaseSeconds: value })} format={(value) => `${value}秒`} /></label>
      </div>
      <p className="step-note">※ 計算方法：1ピックの時間（秒）＝1枚ごとの減少量 ×（ピック開始時のパック残枚数 − 1）＋下駄秒数</p>
    </>}
    {rule.count.type === 'perCard' && (timedTurns > 0
      ? <div className="per-card-grid">{Array.from({ length: timedTurns }, (_, index) => <label className="mini-field" key={index}><span>{pickRange(rule, index + 1)}</span><NumberSelect value={turnSeconds(rule, index + 1)} options={secondOptions} onChange={(value) => { const next = Array.from({ length: Math.max(perCardSeconds.length, index + 1) }, (_, itemIndex) => perCardSeconds[itemIndex] ?? defaultPerCard[itemIndex] ?? 10); next[index] = value; onChange({ type: 'perCard', seconds: next }); }} format={(value) => `${value}秒`} /></label>)}</div>
      : <p className="preview-line">カウント対象のピックはありません</p>)}
    <PickPhasePreviewList rule={rule} />
  </>;
}

export function SettingsModal({
  timers,
  selectedId,
  voices,
  returnFocusRef,
  onClose,
  onSave,
}: {
  timers: TimerSettings[];
  selectedId: string;
  voices: SpeechSynthesisVoice[];
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSave: (timers: TimerSettings[], selectedId: string) => void;
}) {
  const [editorTimers, setEditorTimers] = useState(() => timers.map(cloneTimer));
  const [draftId, setDraftId] = useState(selectedId);
  const [editingPackIndex, setEditingPackIndex] = useState(0);
  const [backupMessage, setBackupMessage] = useState('');
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const draft = editorTimers.find((timer) => timer.id === draftId) ?? editorTimers[0] ?? defaultTimer;
  const estimatedDuration = useMemo(() => estimateMinutes(draft), [draft]);

  const updateDraftState = (updater: (previous: TimerSettings) => TimerSettings) => {
    setEditorTimers((items) => items.map((item) => item.id === draftId ? updater(cloneTimer(item)) : item));
  };
  const updateCommon = <K extends keyof TimerCommonSettings>(key: K, value: TimerCommonSettings[K]) => updateDraftState((previous) => ({ ...previous, common: { ...previous.common, [key]: value } }));
  const updateSpeech = <K extends keyof SpeechSettings>(key: K, value: SpeechSettings[K]) => updateDraftState((previous) => ({ ...previous, common: { ...previous.common, speech: { ...previous.common.speech, [key]: value } } }));
  const updateSharedRule = (patch: Partial<Omit<SharedPackRule, 'count'>> & { count?: CountSettings }) => updateDraftState((previous) => ({ ...previous, sharedRule: { ...previous.sharedRule, ...patch, count: patch.count ? cloneCountSettings(patch.count) : previous.sharedRule.count } }));
  const updateSharedCardCount = (value: number) => updateDraftState((previous) => {
    const cardCount = clamp(value, 2, 30);
    return { ...previous, sharedRule: { ...previous.sharedRule, cardCount, takeCount: clamp(previous.sharedRule.takeCount, 1, cardCount - 1) } };
  });

  const updatePackCount = (value: number) => {
    const packCount = clamp(value, 1, 10);
    updateDraftState((previous) => {
      const packIntervals = Array.from({ length: Math.max(0, packCount - 1) }, (_, index) => previous.common.packIntervals[index] ?? 60);
      const individualRules = previous.individualRules.map(clonePackRule);
      if (previous.individualInitialized) {
        for (let index = individualRules.length; index < packCount; index += 1) {
          const prior = individualRules[index - 1];
          individualRules.push(prior ? { ...clonePackRule(prior), direction: prior.direction === 'left' ? 'right' : 'left' } : sharedPackRule(previous, index + 1));
        }
      }
      return { ...previous, common: { ...previous.common, packCount, packIntervals }, individualRules };
    });
    setEditingPackIndex((previous) => Math.min(previous, packCount - 1));
  };

  const draftPackRules = Array.from({ length: draft.common.packCount }, (_, index) => clonePackRule(draft.individualRules[index] ?? sharedPackRule(draft, index + 1)));
  const draftPackRule = draftPackRules[editingPackIndex] ?? draftPackRules[0];

  const updatePackRule = (patch: Partial<PackRule>) => updateDraftState((previous) => {
    const rules = Array.from({ length: previous.common.packCount }, (_, index) => clonePackRule(previous.individualRules[index] ?? sharedPackRule(previous, index + 1)));
    rules[editingPackIndex] = { ...rules[editingPackIndex], ...patch, count: patch.count ? cloneCountSettings(patch.count) : rules[editingPackIndex].count };
    return { ...previous, individualRules: rules, individualInitialized: true };
  });
  const updatePackCardCount = (value: number) => {
    const cardCount = clamp(value, 2, 30);
    updatePackRule({ cardCount, takeCount: clamp(draftPackRule.takeCount, 1, cardCount - 1) });
  };

  const selectSettingsMode = (mode: SettingsMode) => {
    updateDraftState((previous) => mode !== 'individual' || previous.individualInitialized
      ? { ...previous, mode }
      : { ...previous, mode, individualInitialized: true, individualRules: Array.from({ length: previous.common.packCount }, (_, index) => sharedPackRule(previous, index + 1)) });
    setEditingPackIndex(0);
  };

  const applySharedRuleToAllPacks = () => updateDraftState((previous) => ({ ...previous, individualInitialized: true, individualRules: Array.from({ length: previous.common.packCount }, (_, index) => sharedPackRule(previous, index + 1)) }));
  const copyPreviousPackRule = () => {
    if (editingPackIndex <= 0) return;
    updateDraftState((previous) => {
      const rules = Array.from({ length: previous.common.packCount }, (_, index) => clonePackRule(previous.individualRules[index] ?? sharedPackRule(previous, index + 1)));
      rules[editingPackIndex] = clonePackRule(rules[editingPackIndex - 1]);
      return { ...previous, individualRules: rules, individualInitialized: true };
    });
  };
  const applyCurrentPackRuleToFollowing = () => updateDraftState((previous) => {
    const rules = Array.from({ length: previous.common.packCount }, (_, index) => clonePackRule(previous.individualRules[index] ?? sharedPackRule(previous, index + 1)));
    for (let index = editingPackIndex + 1; index < rules.length; index += 1) rules[index] = clonePackRule(rules[editingPackIndex]);
    return { ...previous, individualRules: rules, individualInitialized: true };
  });
  const applyCurrentPackRuleToAll = () => updateDraftState((previous) => {
    const rules = Array.from({ length: previous.common.packCount }, (_, index) => clonePackRule(previous.individualRules[index] ?? sharedPackRule(previous, index + 1)));
    return { ...previous, individualRules: rules.map(() => clonePackRule(rules[editingPackIndex])), individualInitialized: true };
  });

  const addTimer = () => {
    const copy = normalizeTimer({ ...cloneTimer(defaultTimer), id: crypto.randomUUID(), common: { ...cloneCommonSettings(defaultTimer.common), name: `新しいタイマー ${editorTimers.length + 1}` } });
    setEditorTimers((items) => [...items, copy]); setDraftId(copy.id); setEditingPackIndex(0);
  };
  const copyTimer = () => {
    const copy = normalizeTimer({ ...cloneTimer(draft), id: crypto.randomUUID(), common: { ...cloneCommonSettings(draft.common), name: `${draft.common.name} のコピー`.slice(0, 30) } });
    setEditorTimers((items) => [...items, copy]); setDraftId(copy.id); setEditingPackIndex(0);
  };
  const deleteTimer = () => {
    if (editorTimers.length <= 1 || !window.confirm(`「${draft.common.name}」を削除しますか？`)) return;
    const next = editorTimers.filter((timer) => timer.id !== draft.id);
    setEditorTimers(next); setDraftId(next[0].id); setEditingPackIndex(0);
  };

  const exportSettingsBackup = () => {
    const normalizedTimers = normalizeTimerCollection(editorTimers);
    const selected = normalizedTimers.some((timer) => timer.id === draftId) ? draftId : normalizedTimers[0]?.id;
    const payload = { format: BACKUP_FORMAT, dataVersion: DATA_VERSION, exportedAt: new Date().toISOString(), selectedId: selected, timers: normalizedTimers };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `draft-timer-backup-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setBackupMessage('現在の編集内容をJSONファイルへ書き出しました。');
  };
  const importSettingsBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget; const file = input.files?.[0]; input.value = '';
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) return setBackupMessage('ファイルが大きすぎます。1MB以下のJSONファイルを選択してください。');
    try {
      const imported = parseSettingsBackup(await file.text());
      setEditorTimers(imported.timers.map(cloneTimer)); setDraftId(imported.selectedId); setEditingPackIndex(0);
      setBackupMessage(`${imported.timers.length}件のタイマーを読み込みました。「保存して閉じる」で反映されます。`);
    } catch (error) {
      setBackupMessage(error instanceof Error && error.message === 'unsupported-version' ? 'このアプリより新しい形式のバックアップは読み込めません。' : 'バックアップを読み込めませんでした。正しいJSONファイルか確認してください。');
    }
  };
  const resetEditorToDefaults = () => {
    const initial = cloneTimer(defaultTimer); setEditorTimers([initial]); setDraftId(initial.id); setEditingPackIndex(0);
    setBackupMessage('初期設定を準備しました。「保存して閉じる」で反映されます。');
  };

  const save = () => {
    const normalizedTimers = editorTimers.map(normalizeTimer);
    const selected = normalizedTimers.find((timer) => timer.id === draftId) ?? normalizedTimers[0];
    if (selected) onSave(normalizedTimers, selected.id);
  };

  const handlePackTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % draftPackRules.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + draftPackRules.length) % draftPackRules.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = draftPackRules.length - 1;
    else return;
    event.preventDefault(); setEditingPackIndex(next);
    requestAnimationFrame(() => document.getElementById(`pack-tab-${next}`)?.focus());
  };

  const sharedBasic = <>
    <label className="field full"><span>タイマー名</span><input value={draft.common.name} maxLength={30} onChange={(event) => updateCommon('name', event.target.value)} /></label>
    <div className="field-row"><label className="field"><span>パック数 / 人</span><NumberSelect value={draft.common.packCount} options={packCountOptions} onChange={updatePackCount} format={(value) => `${value}パック`} /></label>{draft.mode === 'shared' && <label className="field"><span>カード枚数 / パック</span><NumberSelect value={draft.sharedRule.cardCount} options={cardCountOptions} onChange={updateSharedCardCount} format={(value) => `${value}枚`} /></label>}</div>
    <div className="field-row">{draft.mode === 'shared' && <label className="field"><span>1ピックの獲得枚数</span><NumberSelect value={draft.sharedRule.cardsPerPick} options={cardsPerPickOptions} onChange={(value) => updateSharedRule({ cardsPerPick: value })} format={(value) => `${value}枚`} /></label>}<label className="field"><span>デッキ構築時間</span><NumberSelect value={Math.round(draft.common.deckBuildSeconds / 60)} options={deckBuildMinuteOptions} onChange={(value) => updateCommon('deckBuildSeconds', value * 60)} format={(value) => value === 0 ? 'なし' : `${value}分`} /></label></div>
    {draft.mode === 'shared' && <TakeLimitFields cardCount={draft.sharedRule.cardCount} takeAll={draft.sharedRule.takeAll} takeCount={draft.sharedRule.takeCount} onChange={updateSharedRule} />}
  </>;
  const intervals = draft.common.packCount > 1 && <fieldset className="settings-card"><legend>パック間インターバル</legend><div className="interval-grid">{Array.from({ length: draft.common.packCount - 1 }, (_, index) => <label className="field" key={index}><span>{index + 1} → {index + 2} パック</span><NumberSelect value={draft.common.packIntervals[index] ?? 60} options={nonNegativeSecondOptions} onChange={(value) => { const next = [...draft.common.packIntervals]; next[index] = value; updateCommon('packIntervals', next); }} format={(value) => value === 0 ? 'なし' : value >= 60 && value % 60 === 0 ? `${value}秒（${value / 60}分）` : `${value}秒`} /></label>)}</div></fieldset>;
  const speech = <fieldset className="settings-card"><legend>音声案内</legend><label className="toggle-field"><input type="checkbox" checked={draft.common.speech.enabled} onChange={(event) => updateSpeech('enabled', event.target.checked)} /><span>ブラウザの音声で案内する</span></label><label className="field full"><span>音声</span><select value={draft.common.speech.voice} onChange={(event) => updateSpeech('voice', event.target.value)}><option value="">端末の標準音声</option>{voices.filter((voice) => voice.lang.startsWith('ja')).map((voice) => <option value={voice.name} key={voice.name}>{voice.name}</option>)}</select></label><div className="field-row"><label className="field"><span>読み上げ速度</span><NumberSelect value={draft.common.speech.rate} options={speechRateOptions} onChange={(value) => updateSpeech('rate', value)} format={(value) => `${value.toFixed(1)}×`} /></label><label className="field"><span>音量</span><NumberSelect value={draft.common.speech.volume} options={speechVolumeOptions} onChange={(value) => updateSpeech('volume', value)} format={(value) => `${Math.round(value * 100)}%`} /></label></div></fieldset>;

  return (
    <AccessibleDialog labelledBy="settings-title" className="settings-modal" onClose={onClose} returnFocusRef={returnFocusRef}>
      <header className="settings-header"><div><p className="eyebrow">LOCAL SETTINGS</p><h2 id="settings-title">タイマー設定</h2></div><button className="close-button" type="button" onClick={onClose} aria-label="閉じる">×</button></header>
      <div className="settings-scroll-area">
        <div className="settings-toolbar"><label><span>編集するタイマー</span><select value={draft.id} onChange={(event) => { setDraftId(event.target.value); setEditingPackIndex(0); }}>{editorTimers.map((timer) => <option value={timer.id} key={timer.id}>{timer.common.name}</option>)}</select></label><div className="compact-actions"><button type="button" onClick={addTimer}>＋ 新規</button><button type="button" onClick={copyTimer}>複製</button><button className="danger" type="button" onClick={deleteTimer} disabled={editorTimers.length <= 1}>削除</button></div></div>
        <div className="settings-mode-bar"><div><span>設定方式</span><small>{draft.mode === 'shared' ? 'すべてのパックに同じルールを適用します' : '以前の個別設定を保持し、パックごとにルールを適用します'}</small></div><div className="settings-mode-toggle" role="group" aria-label="設定方式"><button type="button" className={draft.mode === 'shared' ? 'selected' : ''} aria-pressed={draft.mode === 'shared'} onClick={() => selectSettingsMode('shared')}>全パック共通設定</button><button type="button" className={draft.mode === 'individual' ? 'selected' : ''} aria-pressed={draft.mode === 'individual'} onClick={() => selectSettingsMode('individual')}>全パック個別設定</button></div></div>

        {draft.mode === 'shared' ? <div className="settings-grid">
          <div className="settings-column"><fieldset className="settings-card"><legend>基本設定</legend>{sharedBasic}</fieldset>{intervals}<fieldset className="settings-card"><legend>回す方向</legend><div className="segmented"><button type="button" className={draft.sharedRule.directionMode === 'alternate' ? 'selected' : ''} onClick={() => updateSharedRule({ directionMode: 'alternate' })}>パックごとに交互</button><button type="button" className={draft.sharedRule.directionMode === 'fixed' ? 'selected' : ''} onClick={() => updateSharedRule({ directionMode: 'fixed' })}>固定</button></div><div className="segmented compact"><button type="button" className={draft.sharedRule.initialDirection === 'left' ? 'selected' : ''} onClick={() => updateSharedRule({ initialDirection: 'left' })}>← 左から開始</button><button type="button" className={draft.sharedRule.initialDirection === 'right' ? 'selected' : ''} onClick={() => updateSharedRule({ initialDirection: 'right' })}>右から開始 →</button></div><p className="preview-line">{Array.from({ length: Math.min(3, draft.common.packCount) }, (_, index) => `${index + 1}P: ${sharedDirectionForPack(draft.sharedRule, index + 1) === 'left' ? '左' : '右'}`).join('　')}</p></fieldset></div>
          <div className="settings-column"><fieldset className="settings-card"><legend>カウント方式</legend><CountSettingsFields rule={sharedPackRule(draft, 1)} onChange={(count) => updateSharedRule({ count })} /></fieldset>{speech}</div>
        </div> : <div className="settings-grid individual-settings-grid">
          <div className="settings-column"><fieldset className="settings-card"><legend>共通設定</legend>{sharedBasic}</fieldset>{intervals}{speech}</div>
          <div className="settings-column"><fieldset className="settings-card pack-settings-card"><legend>パックごとの設定</legend>
            <div className="pack-copy-actions"><button type="button" onClick={copyPreviousPackRule} disabled={editingPackIndex === 0}>前のパックからコピー</button><button type="button" onClick={applyCurrentPackRuleToFollowing} disabled={editingPackIndex >= draft.common.packCount - 1}>この設定を以降へ適用</button><button type="button" onClick={applyCurrentPackRuleToAll}>この設定を全パックへ適用</button><button type="button" onClick={applySharedRuleToAllPacks}>共通ルールで全パックを作り直す</button></div>
            <p className="pack-settings-note">初回は共通設定から作成され、以後は個別設定として保持されます。</p>
            <div className="pack-tabs" role="tablist" aria-label="設定するパック">{draftPackRules.map((rule, index) => {
              const takeSummary = rule.takeAll ? '全取得' : `${rule.takeCount}枚取得`;
              return <button id={`pack-tab-${index}`} type="button" role="tab" aria-selected={editingPackIndex === index} aria-controls="pack-settings-panel" tabIndex={editingPackIndex === index ? 0 : -1} aria-label={`${index + 1}パック目、${rule.cardCount}枚、1回${rule.cardsPerPick}枚、${takeSummary}、${rule.direction === 'left' ? '左' : '右'}、${countTypeLabel(rule.count)}`} className={editingPackIndex === index ? 'selected' : ''} onClick={() => setEditingPackIndex(index)} onKeyDown={(event) => handlePackTabKeyDown(event, index)} key={index}><span>{index + 1}パック目</span><small>{rule.cardCount}枚・1回{rule.cardsPerPick}枚・{takeSummary}・{rule.direction === 'left' ? '左' : '右'}・{countTypeLabel(rule.count)}</small></button>;
            })}</div>
            <div id="pack-settings-panel" className="pack-settings-panel" role="tabpanel" aria-label={`${editingPackIndex + 1}パック目の設定`}>
              <div className="pack-panel-heading"><strong>{editingPackIndex + 1}パック目</strong><span>{draftPackRule.cardCount}枚・1回{draftPackRule.cardsPerPick}枚・{draftPackRule.takeAll ? '全て取得' : `合計${draftPackRule.takeCount}枚取得`}</span></div>
              <div className="field-row"><label className="field"><span>カード枚数</span><NumberSelect value={draftPackRule.cardCount} options={cardCountOptions} onChange={updatePackCardCount} format={(value) => `${value}枚`} /></label><label className="field"><span>1ピックの獲得枚数</span><NumberSelect value={draftPackRule.cardsPerPick} options={cardsPerPickOptions} onChange={(value) => updatePackRule({ cardsPerPick: value })} format={(value) => `${value}枚`} /></label></div>
              <TakeLimitFields cardCount={draftPackRule.cardCount} takeAll={draftPackRule.takeAll} takeCount={draftPackRule.takeCount} onChange={updatePackRule} />
              <section className="pack-rule-section" aria-labelledby={`direction-heading-${editingPackIndex}`}><h3 id={`direction-heading-${editingPackIndex}`}>回す方向</h3><div className="segmented compact"><button type="button" className={draftPackRule.direction === 'left' ? 'selected' : ''} aria-pressed={draftPackRule.direction === 'left'} onClick={() => updatePackRule({ direction: 'left' })}>← 左隣へ</button><button type="button" className={draftPackRule.direction === 'right' ? 'selected' : ''} aria-pressed={draftPackRule.direction === 'right'} onClick={() => updatePackRule({ direction: 'right' })}>右隣へ →</button></div></section>
              <section className="pack-rule-section" aria-labelledby={`count-heading-${editingPackIndex}`}><h3 id={`count-heading-${editingPackIndex}`}>カウント方式</h3><CountSettingsFields rule={draftPackRule} onChange={(count) => updatePackRule({ count })} /></section>
            </div>
          </fieldset></div>
        </div>}

        <details className="settings-data-tools"><summary><span><strong>設定データのバックアップ</strong><small>端末の外へ保存・復元できます</small></span><span className="data-version">データ形式 v{DATA_VERSION}</span></summary><div className="settings-data-tools-body"><p>JSONの読み込みや初期化は一時編集として扱われます。「保存して閉じる」を押すまで実際の設定には反映されません。</p><div><button type="button" onClick={exportSettingsBackup}>JSONを書き出す</button><button type="button" onClick={() => importInputRef.current?.click()}>JSONを読み込む</button><button className="danger" type="button" onClick={resetEditorToDefaults}>すべて初期設定へ戻す</button><input ref={importInputRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={importSettingsBackup} tabIndex={-1} aria-hidden="true" /></div>{backupMessage && <p className="backup-message" role="status">{backupMessage}</p>}</div></details>
        <footer className="settings-footer"><span>予想所要時間：約 {estimatedDuration}分</span><div><button className="secondary-button" type="button" onClick={onClose}>キャンセル</button><button className="save-button" type="button" onClick={save} disabled={!draft.common.name.trim()}>保存して閉じる</button></div></footer>
      </div>
    </AccessibleDialog>
  );
}
