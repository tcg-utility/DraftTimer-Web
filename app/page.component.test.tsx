import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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
      '1パック目、4枚、1回1枚、右、固定',
      '2パック目、4枚、1回1枚、右、固定',
      '3パック目、4枚、1回1枚、右、固定',
    ]);

    await user.click(within(dialog).getByRole('button', { name: '全パック共通設定' }));
    await user.click(within(dialog).getByRole('button', { name: '全パック個別設定' }));
    expect(within(dialog).getAllByRole('tab').map((tab) => tab.getAttribute('aria-label'))).toEqual([
      '1パック目、4枚、1回1枚、右、固定',
      '2パック目、4枚、1回1枚、右、固定',
      '3パック目、4枚、1回1枚、右、固定',
    ]);
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
    expect(screen.getByRole('status').textContent).toBe('一時停止中');
    fireEvent.click(screen.getByRole('button', { name: 'リセット' }));
    expect(screen.getByRole('status').textContent).toBe('停止中');
    expect(screen.getByLabelText(/^残り/).textContent).toBe('00:40');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
  });
});
