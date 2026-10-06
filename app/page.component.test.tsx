import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { cloneTimer, defaultTimer } from '@/lib/timer-domain';
import { PROGRESS_STORAGE_KEY, timerSignature, writeSettings } from '@/lib/settings-storage';
import Home from './page';

async function openSettings() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '設定を開く' }));
  return { user, dialog: screen.getByRole('dialog', { name: 'タイマー設定' }) };
}

describe('settings editor', () => {
  it('新規作成・複製・変更をキャンセルすると保存状態へ戻る', async () => {
    render(<Home />);
    const { user, dialog } = await openSettings();
    const editorSelect = within(dialog).getByRole('combobox', { name: '編集するタイマー' });

    expect(within(editorSelect).getAllByRole('option')).toHaveLength(1);
    await user.click(within(dialog).getByRole('button', { name: '＋ 新規' }));
    const nameInput = within(dialog).getByRole('textbox', { name: 'タイマー名' });
    await user.clear(nameInput);
    await user.type(nameInput, '検証用タイマー');
    await user.click(within(dialog).getByRole('button', { name: '複製' }));
    expect(within(editorSelect).getAllByRole('option')).toHaveLength(3);

    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
    const mainSelect = screen.getByRole('combobox', { name: '使用するタイマー' });
    expect(within(mainSelect).getAllByRole('option').map((option) => option.textContent)).toEqual(['Standard Draft']);

    await user.click(screen.getByRole('button', { name: '設定を開く' }));
    const reopened = screen.getByRole('dialog', { name: 'タイマー設定' });
    expect(within(reopened).getByRole('textbox', { name: 'タイマー名' }).getAttribute('value')).toBe('Standard Draft');
  });

  it('個別設定のパックタブとコピー内容をモード切替後も保持する', async () => {
    render(<Home />);
    const { user, dialog } = await openSettings();

    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'パック数 / 人' }), '3');
    await user.click(within(dialog).getByRole('button', { name: '全パック個別設定' }));
    expect(within(dialog).getAllByRole('tab')).toHaveLength(3);

    const packPanel = within(dialog).getByRole('tabpanel', { name: '1パック目の設定' });
    await user.selectOptions(within(packPanel).getByRole('combobox', { name: 'カード枚数' }), '4');
    await user.click(within(packPanel).getByRole('button', { name: '右隣へ →' }));
    await user.click(within(packPanel).getByRole('button', { name: '固定' }));
    await user.selectOptions(within(packPanel).getByRole('combobox', { name: '1ピックの時間' }), '3');
    await user.click(within(dialog).getByRole('button', { name: 'この設定を全パックへ適用' }));

    expect(within(dialog).getAllByRole('tab').map((tab) => tab.getAttribute('aria-label'))).toEqual([
      '1パック目、4枚、1回1枚、全取得、右、固定',
      '2パック目、4枚、1回1枚、全取得、右、固定',
      '3パック目、4枚、1回1枚、全取得、右、固定',
    ]);

    await user.click(within(dialog).getByRole('button', { name: '全パック共通設定' }));
    await user.click(within(dialog).getByRole('button', { name: '全パック個別設定' }));
    expect(within(dialog).getAllByRole('tab').map((tab) => tab.getAttribute('aria-label'))).toEqual([
      '1パック目、4枚、1回1枚、全取得、右、固定',
      '2パック目、4枚、1回1枚、全取得、右、固定',
      '3パック目、4枚、1回1枚、全取得、右、固定',
    ]);
  });

  it('取得枚数を共通設定とパック個別設定で変更できる', async () => {
    render(<Home />);
    const { user, dialog } = await openSettings();

    const sharedTakeAll = within(dialog).getByRole('checkbox', { name: '全て取る' });
    expect(sharedTakeAll.getAttribute('checked')).not.toBeNull();
    expect(within(dialog).queryByRole('combobox', { name: '取得枚数' })).toBeNull();

    await user.click(sharedTakeAll);
    const sharedTakeCount = within(dialog).getByRole('combobox', { name: '取得枚数' });
    const options = within(sharedTakeCount).getAllByRole('option');
    expect(options[0].textContent).toBe('1枚');
    expect(options.at(-1)?.textContent).toBe('14枚');
    await user.selectOptions(sharedTakeCount, '5');
    expect(within(within(dialog).getByRole('region', { name: 'ピック時間プレビュー' })).getAllByRole('listitem')).toHaveLength(5);

    await user.click(within(dialog).getByRole('button', { name: '全パック個別設定' }));
    const firstPanel = within(dialog).getByRole('tabpanel', { name: '1パック目の設定' });
    expect(within(firstPanel).getByRole('checkbox', { name: '全て取る' }).getAttribute('checked')).toBeNull();
    await user.selectOptions(within(firstPanel).getByRole('combobox', { name: '取得枚数' }), '3');
    await user.click(within(dialog).getAllByRole('tab')[1]);
    const secondPanel = within(dialog).getByRole('tabpanel', { name: '2パック目の設定' });
    expect((within(secondPanel).getByRole('combobox', { name: '取得枚数' }) as unknown as HTMLSelectElement).value).toBe('5');
    expect(within(dialog).getAllByRole('tab').map((tab) => tab.getAttribute('aria-label'))).toEqual(expect.arrayContaining([
      expect.stringContaining('1パック目、15枚、1回1枚、3枚取得'),
      expect.stringContaining('2パック目、15枚、1回1枚、5枚取得'),
    ]));
  });

  it('予想所要時間は音声設定では変わらず進行設定では変わる', async () => {
    render(<Home />);
    const { user, dialog } = await openSettings();
    const estimate = () => within(dialog).getByText(/予想所要時間：約/).textContent ?? '';
    const original = estimate();

    await user.click(within(dialog).getByRole('checkbox', { name: 'ブラウザの音声で案内する' }));
    await user.selectOptions(within(dialog).getByRole('combobox', { name: '読み上げ速度' }), '2');
    expect(estimate()).toBe(original);

    const countGroups = within(dialog).getAllByRole('group', { name: 'カウント方式' });
    await user.click(within(countGroups[countGroups.length - 1]).getByRole('button', { name: '固定' }));
    await user.selectOptions(within(dialog).getByRole('combobox', { name: '1ピックの時間' }), '30');
    const afterPickChange = estimate();
    expect(afterPickChange).not.toBe(original);
    expect(afterPickChange).toMatch(/^予想所要時間：約 \d+\.\d分$/);

    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'デッキ構築時間' }), '40');
    const beforeDeckIncrease = Number(afterPickChange.match(/([\d.]+)分/)?.[1]);
    const afterDeckIncrease = Number(estimate().match(/([\d.]+)分/)?.[1]);
    expect(afterDeckIncrease - beforeDeckIncrease).toBeGreaterThanOrEqual(19.9);
    expect(afterDeckIncrease - beforeDeckIncrease).toBeLessThanOrEqual(20.1);
  });
});

describe('timer operation', () => {
  it('スマホ用の予想所要時間をタイマー画面に表示する', () => {
    render(<Home />);

    const estimate = screen.getByLabelText(/^予想所要時間：約 \d+\.\d分$/);
    expect(estimate.textContent).toMatch(/^予想 約 \d+\.\d分$/);
  });

  it('一時停止中は減算せず、フェイズ移動とリセットでも停止状態を保つ', async () => {
    vi.useFakeTimers();
    render(<Home />);

    fireEvent.click(screen.getByRole('button', { name: '▶ 開始' }));
    fireEvent.click(screen.getByRole('button', { name: '確認して開始' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_500);
    });
    expect(screen.getByRole('status').textContent).toBe('カウント中');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    const timeBeforePause = screen.getByLabelText(/^残り/).textContent;
    fireEvent.click(screen.getByRole('button', { name: /一時停止/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByLabelText(/^残り/).textContent).toBe(timeBeforePause);
    expect(screen.getByRole('status').textContent).toBe('一時停止中');

    fireEvent.click(screen.getByRole('button', { name: '次のフェイズ →' }));
    fireEvent.click(screen.getByRole('button', { name: '移動する' }));
    expect(screen.getByRole('status').textContent).toBe('一時停止中');
    fireEvent.click(screen.getByRole('button', { name: 'リセット' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '進行をリセットしますか？' })).getByRole('button', { name: 'リセット' }));
    expect(screen.getByRole('status').textContent).toBe('停止中');
    expect(screen.getByLabelText(/^残り/).textContent).toBe('00:40');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
  });

  it('進行中の下段フェイズ操作は短押しでは動かず、0.8秒長押しで確定する', async () => {
    vi.useFakeTimers();
    render(<Home />);

    fireEvent.click(screen.getByRole('button', { name: '▶ 開始' }));
    fireEvent.click(screen.getByRole('button', { name: '確認して開始' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_500);
    });

    const currentPhase = () => document.querySelector<HTMLButtonElement>('.phase-item[aria-current="step"]')?.textContent;
    const before = currentPhase();
    const nextButton = screen.getByRole('button', { name: '次のフェイズ →' });
    expect(screen.getByText('進行中：リセットと「前／先頭／次」の操作は0.8秒長押し')).toBeTruthy();

    fireEvent.pointerDown(nextButton);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(799);
    });
    fireEvent.pointerUp(nextButton);
    fireEvent.click(nextButton, { detail: 1 });
    expect(currentPhase()).toBe(before);
    expect(screen.queryByRole('dialog', { name: 'フェイズを移動しますか？' })).toBeNull();

    fireEvent.pointerDown(nextButton);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    fireEvent.pointerUp(nextButton);
    fireEvent.click(nextButton, { detail: 1 });
    expect(currentPhase()).not.toBe(before);
    expect(screen.queryByRole('dialog', { name: 'フェイズを移動しますか？' })).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
  });

  it('開始前チェックに運用情報を表示する', () => {
    render(<Home />);
    fireEvent.click(screen.getByRole('button', { name: '▶ 開始' }));
    const dialog = screen.getByRole('dialog', { name: '開始前チェック' });
    expect(within(dialog).getByText('3パック / 人')).toBeTruthy();
    expect(within(dialog).getByText(/^約 \d+\.\d分$/)).toBeTruthy();
    expect(within(dialog).queryByText('音声案内')).toBeNull();
    expect(within(dialog).queryByText('画面消灯防止')).toBeNull();
  });

  it('設定画面はEscapeで閉じ、設定ボタンへフォーカスを戻す', async () => {
    render(<Home />);
    const settingsButton = screen.getByRole('button', { name: '設定を開く' });
    fireEvent.click(settingsButton);
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'タイマー設定' }).contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'タイマー設定' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(settingsButton));
  });

  it('残り時間バーを支援技術へ公開する', () => {
    render(<Home />);
    const progress = screen.getByRole('progressbar', { name: 'フェイズの残り時間' });
    expect(progress.getAttribute('aria-valuemin')).toBe('0');
    expect(progress.getAttribute('aria-valuetext')).toMatch(/^残り\d{2}:\d{2}$/);
  });

  it('前回の残り時間を自動再生せず一時停止状態で復元する', async () => {
    const timer = cloneTimer(defaultTimer);
    writeSettings({ timers: [timer], selectedId: timer.id });
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify({
      version: 1,
      timerId: timer.id,
      timerSignature: timerSignature(timer),
      savedAt: new Date().toISOString(),
      active: { type: 'counting', stepIndex: 2, remainingMs: 12_345, countdown: 'pick' },
    }));
    render(<Home />);
    const dialog = await screen.findByRole('dialog', { name: '前回の進行が見つかりました' });
    fireEvent.click(within(dialog).getByRole('button', { name: '前回の進行を再開' }));
    expect(screen.getByRole('status').textContent).toBe('一時停止中');
    expect(screen.getByLabelText(/^残り/).textContent).toBe('00:13');
  });
});
