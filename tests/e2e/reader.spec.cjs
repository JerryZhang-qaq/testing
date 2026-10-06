const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fixture } = require('../fixtures.cjs');

let app, page, root, dataDir;
const launch = async () => {
  app = await electron.launch({
    args: [...(process.env.LANREAD_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), path.resolve('.')],
    env: { ...process.env, LANREAD_DATA_DIR: dataDir, LANREAD_DEV_URL: '' },
  });
  page = await app.firstWindow();
  page.on('pageerror', error => console.error('Renderer error:', error.message));
  page.on('console', message => { if (message.type() === 'error') console.error('Renderer console:', message.text()); });
  await expect(page.getByRole('heading', { name: '全部书籍', exact: true })).toBeVisible();
};
const importPaths = async paths => {
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
  }, paths);
  await page.getByRole('button', { name: '导入书籍', exact: true }).click();
};

test.beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'lanread-e2e-'));
  dataDir = path.join(root, 'data');
  await launch();
});
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && page && !page.isClosed()) {
    await page.screenshot({ path: testInfo.outputPath('failure.png') });
    console.error(await page.locator('body').innerText());
  }
  await app?.close();
  await fs.rm(root, { recursive: true, force: true });
});

test('EPUB 2/3 series, rendering, independent notes, appearance and restart', async () => {
  const first = path.join(root, 'one.epub'), second = path.join(root, 'two.epub');
  await fs.writeFile(first, await fixture({ title: '风与书页', index: 1 }));
  await fs.writeFile(second, await fixture({ title: '云的远方', index: 2, version: 2, cover: false }));
  await importPaths([second, first]);
  await expect(page.getByRole('button', { name: '展开系列 蓝色故事' })).toBeVisible();
  await page.getByRole('button', { name: '展开系列 蓝色故事' }).click();
  await expect(page.locator('.book-card')).toHaveCount(2);
  await expect(page.locator('.book-card').first()).toContainText('风与书页');
  await expect(page.getByAltText('风与书页封面')).toBeVisible();
  await page.getByRole('button', { name: '阅读 风与书页' }).click();
  await expect(page.getByRole('button', { name: '在当前位置添加书签' })).toBeEnabled();
  await expect(page.frameLocator('iframe').locator('body')).toContainText('风从书页间经过');
  await expect(page.getByLabel('阅读进度')).toBeEnabled();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.reading-bottom-note')).toContainText('本章 2 /');
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await expect(page.locator('.reading-bottom-note')).toContainText('本章 1 /');
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByRole('button', { name: '第二章 远行', exact: true }).click();
  await expect(page.frameLocator('iframe').getByRole('heading', { name: '第二章 远行' })).toBeVisible();
  await page.getByRole('button', { name: '在当前位置添加书签' }).click();
  await page.getByLabel('书签标题').fill('留给明天');
  await page.getByLabel('书签备注', { exact: true }).fill('第二章里的第一条独立备注。');
  await expect(page.locator('.save-status')).toContainText('已保存');
  await page.getByRole('button', { name: '添加当前位置' }).click();
  await page.getByLabel('书签标题').fill('另一根书签');
  await page.getByLabel('书签备注', { exact: true }).fill('同一位置，也有另一条备注。');
  await expect(page.locator('.save-status')).toContainText('已保存');
  await expect(page.locator('.bookmark-item')).toHaveCount(2);
  await page.getByRole('button', { name: /留给明天/ }).click();
  await expect(page.getByLabel('书签备注', { exact: true })).toHaveValue('第二章里的第一条独立备注。');
  await page.screenshot({ path: 'test-results/reader-bookmarks.png' });
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('button', { name: '夜读配色' }).click();
  await expect(page.frameLocator('iframe').locator('body')).toHaveCSS('background-color', 'rgb(25, 38, 51)');
  await page.getByLabel('正文字体').selectOption('sans');
  await page.getByLabel('字号', { exact: true }).fill('26');
  await expect(page.frameLocator('iframe').locator('body')).toHaveCSS('font-size', '26px');
  await page.getByRole('button', { name: '书库', exact: true }).click();
  await page.getByRole('button', { name: '阅读 云的远方' }).click();
  await expect(page.getByRole('button', { name: '在当前位置添加书签' })).toBeEnabled();
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByRole('button', { name: '第二章 远行', exact: true }).click();
  await expect(page.frameLocator('iframe').getByRole('heading', { name: '第二章 远行' })).toBeVisible();
  await page.getByRole('button', { name: '书库', exact: true }).click();
  await app.close();
  await launch();
  await page.getByRole('button', { name: '展开系列 蓝色故事' }).click();
  await page.getByRole('button', { name: '阅读 风与书页' }).click();
  await expect(page.frameLocator('iframe').getByRole('heading', { name: '第二章 远行' })).toBeVisible();
  await expect(page.frameLocator('iframe').locator('body')).toHaveCSS('font-size', '26px');
  await page.getByRole('button', { name: /^书签/ }).click();
  await page.getByRole('button', { name: /另一根书签/ }).click();
  await expect(page.getByLabel('书签备注', { exact: true })).toHaveValue('同一位置，也有另一条备注。');
  await page.getByRole('button', { name: '删除当前书签' }).click();
  await expect(page.locator('.bookmark-item')).toHaveCount(1);
});

test('Manual series edits, library search, duplicate and damaged import, deletion', async () => {
  const file = path.join(root, 'single.epub'), bad = path.join(root, 'bad.epub');
  await fs.writeFile(file, await fixture({ series: '', title: '一场蓝色的旅行', author: '晴川' }));
  await fs.writeFile(bad, 'broken');
  await importPaths([file, bad]);
  await expect(page.getByRole('dialog', { name: '部分书籍未能导入' })).toBeVisible();
  await page.getByRole('button', { name: '知道了' }).click();
  await importPaths([file]);
  await expect(page.getByRole('status')).toContainText('跳过 1 本重复书籍');
  await page.getByRole('button', { name: '一场蓝色的旅行的菜单' }).click();
  await page.getByRole('button', { name: '编辑系列', exact: true }).click();
  await page.getByLabel('系列名称').fill('旅途');
  await page.getByLabel('系列内册序').fill('1.5');
  await page.getByRole('button', { name: '保存系列' }).click();
  await page.getByLabel('搜索书库').fill('晴川');
  await expect(page.getByRole('button', { name: '展开系列 旅途' })).toBeVisible();
  await page.getByRole('button', { name: '展开系列 旅途' }).click();
  await page.getByRole('button', { name: '一场蓝色的旅行的菜单' }).click();
  await page.getByRole('button', { name: '移出书库', exact: true }).click();
  await page.getByRole('button', { name: '确认移除' }).click();
  await expect(page.locator('.book-card')).toHaveCount(0);
  expect(await fs.readFile(file)).toBeTruthy();
});

test('Book scripts are disabled and remote content cannot contact the Internet', async () => {
  const file = path.join(root, 'scripted.epub');
  await fs.writeFile(file, await fixture({ series: '', scripted: true }));
  await importPaths([file]);
  await page.getByRole('button', { name: '阅读 风与书页' }).click();
  await expect(page.getByRole('button', { name: '在当前位置添加书签' })).toBeEnabled();
  expect(await page.locator('iframe').getAttribute('sandbox')).not.toContain('allow-scripts');
  expect(await page.evaluate(() => window.bookScriptRan)).toBeUndefined();
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('img[alt="remote"]')).toHaveJSProperty('naturalWidth', 0);
});
