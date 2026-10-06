import { expect, test } from '@playwright/test';

const tinyTimerStore = {
  dataVersion: 3,
  selectedId: 'e2e-timer',
  timers: [{
    schemaVersion: 3,
    id: 'e2e-timer',
    mode: 'shared',
    common: {
      name: 'E2E Timer',
      packCount: 2,
      packIntervals: [1],
      deckBuildSeconds: 1,
      speech: { enabled: false, voice: '', rate: 1, volume: 1 },
    },
    sharedRule: {
      cardCount: 2,
      cardsPerPick: 1,
      takeAll: true,
      takeCount: 1,
      directionMode: 'alternate',
      initialDirection: 'left',
      count: { type: 'fixed', seconds: 1 },
    },
    individualRules: [],
    individualInitialized: false,
  }],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((store) => localStorage.setItem('drafttimer:web:v1', JSON.stringify(store)), tinyTimerStore);
});

test('320px幅で設定全体をスクロールでき、横にはみ出さない', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: '設定を開く' }).click();
  const dialog = page.getByRole('dialog', { name: 'タイマー設定' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '保存して閉じる' }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('button', { name: '保存して閉じる' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('個別設定のパックタブを左右キーで移動できる', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: '設定を開く' }).click();
  await page.getByRole('button', { name: '全パック個別設定' }).click();
  const firstTab = page.getByRole('tab').first();
  await firstTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
});

test('取得枚数を共通設定からパック個別設定へ引き継げる', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: '設定を開く' }).click();
  const dialog = page.getByRole('dialog', { name: 'タイマー設定' });

  await expect(dialog.getByRole('checkbox', { name: '全て取る' })).toBeChecked();
  await dialog.getByRole('combobox', { name: 'カード枚数 / パック' }).selectOption('5');
  await dialog.getByRole('checkbox', { name: '全て取る' }).uncheck();
  await dialog.getByRole('combobox', { name: '取得枚数' }).selectOption('3');
  await expect(dialog.getByRole('region', { name: 'ピック時間プレビュー' }).getByRole('listitem')).toHaveCount(3);

  await dialog.getByRole('button', { name: '全パック個別設定' }).click();
  const firstPanel = dialog.getByRole('tabpanel', { name: '1パック目の設定' });
  await expect(firstPanel.getByRole('checkbox', { name: '全て取る' })).not.toBeChecked();
  await expect(firstPanel.getByRole('combobox', { name: '取得枚数' })).toHaveValue('3');
  await firstPanel.getByRole('combobox', { name: '取得枚数' }).selectOption('2');
  await expect(dialog.getByRole('tab').first()).toHaveAttribute('aria-label', /2枚取得/);
  await expect(dialog.getByRole('tab').nth(1)).toHaveAttribute('aria-label', /3枚取得/);
});

test('進行中の下段フェイズ操作は長押しで確定する', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: /開始$/ }).click();
  await page.getByRole('button', { name: '確認して開始' }).click();
  await page.getByRole('button', { name: /一時停止/ }).click();
  await expect(page.getByText('進行中：リセットと「前／先頭／次」の操作は0.8秒長押し')).toBeVisible();

  const currentLabel = page.locator('.mobile-phase-row > strong');
  const before = await currentLabel.textContent();
  const nextButton = page.getByRole('button', { name: '次のフェイズ →' });

  await nextButton.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0 });
  await page.waitForTimeout(200);
  await nextButton.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0 });
  await nextButton.dispatchEvent('click', { detail: 1 });
  await expect(currentLabel).toHaveText(before ?? '');

  await nextButton.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0 });
  await page.waitForTimeout(850);
  await nextButton.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0 });
  await expect(currentLabel).not.toHaveText(before ?? '');
  await expect(page.getByRole('dialog', { name: 'フェイズを移動しますか？' })).toHaveCount(0);
});

test('全フェイズを高速再生して完了できる', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '高速クロック検証はChromiumで一度実行する');
  await page.clock.install();
  await page.goto('./');
  await page.getByRole('button', { name: /開始$/ }).click();
  await page.getByRole('button', { name: '確認して開始' }).click();
  for (let second = 0; second < 45; second += 1) await page.clock.fastForward(1_000);
  await expect(page.getByRole('status')).toHaveText('完了');
  expect(await page.evaluate(() => localStorage.getItem('drafttimer:web:progress:v1'))).toBeNull();
});

test('初回キャッシュ後はオフラインでも起動できる', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Service Workerのオフライン検証はChromiumで実行する');
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Draft Timer' })).toBeVisible();
  await context.setOffline(false);
});

test('PWA資材にバージョン付きキャッシュとホーム画面アイコンを含む', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '生成済み資材の検証はChromiumで一度実行する');
  await page.goto('./');
  const result = await page.evaluate(async () => {
    const worker = await fetch('./sw.js').then((response) => response.text());
    const manifest = await fetch('./manifest.webmanifest').then((response) => response.json()) as { icons: unknown[] };
    return { worker, icons: manifest.icons };
  });
  expect(result.worker).toMatch(/draft-timer-[a-f0-9]{12}/);
  expect(result.worker).toContain('SKIP_WAITING');
  expect(result.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: '192x192' }),
    expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
  ]));
});
