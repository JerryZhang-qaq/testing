// Invoked by the Windows packaging workflow before publishing a release.
const { _electron: electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { fixture } = require('./fixtures.cjs');
const version = require('../package.json').version;
const root = process.env.LANREAD_UPGRADE_ROOT;
const executable = process.env.LANREAD_UPGRADE_EXE;
const stage = process.argv[2];
const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

(async () => {
  assert.ok(root && executable && ['seed', 'verify'].includes(stage), 'Upgrade test paths and stage required');
  const dataDir = path.join(root, 'data');
  const expectedPath = path.join(root, 'expected.json');
  if (stage === 'verify') {
    const expected = JSON.parse(await fs.readFile(expectedPath, 'utf8'));
    // Verify the installer did not even rewrite user data before the new app runs.
    assert.equal(hash(await fs.readFile(path.join(dataDir, 'library.json'))), expected.libraryHash);
    assert.equal(hash(await fs.readFile(path.join(dataDir, 'books', `${expected.bookId}.epub`))), expected.bookHash);
  }
  const app = await electron.launch({ executablePath: executable, env: { ...process.env, LANREAD_DATA_DIR: dataDir, LANREAD_DEV_URL: '' } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: '全部书籍', exact: true })).toBeVisible();
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), stage === 'seed' ? '0.1.0' : version);
    if (stage === 'seed') {
      await fs.mkdir(root, { recursive: true });
      const original = path.join(root, 'upgrade-original.epub');
      await fs.writeFile(original, await fixture({ title: '升级保留测试' }));
      await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, original);
      const state = await page.evaluate(async () => {
        const api = window.lanread;
        const result = await api.importBooks();
        const id = result.state.books[0].id;
        await api.updateBook(id, { series: '保留系列', seriesIndex: 1.5, cfi: 'epubcfi(/6/2[ch1]!/4/2/1:0)', progress: .42 });
        await api.saveBookmark(id, { cfi: 'epubcfi(/6/2[ch1]!/4/2/1:0)', title: '保留书签', note: '升级后仍在的独立备注', chapter: '第一章' });
        await api.saveSettings({ font: 'sans', fontSize: 26, lineHeight: 2, theme: 'custom', background: '#e3f1ff', foreground: '#263746' });
        return api.list();
      });
      await fs.unlink(original);
      const bookId = state.books[0].id;
      await fs.writeFile(expectedPath, JSON.stringify({ state, bookId, libraryHash: hash(await fs.readFile(path.join(dataDir, 'library.json'))), bookHash: hash(await fs.readFile(path.join(dataDir, 'books', `${bookId}.epub`))) }));
    } else {
      const expected = JSON.parse(await fs.readFile(expectedPath, 'utf8'));
      const state = await page.evaluate(() => window.lanread.list());
      assert.deepEqual(state.books, expected.state.books);
      assert.deepEqual(state.settings, expected.state.settings);
      await page.getByRole('button', { name: '展开系列 保留系列' }).click();
      await page.getByRole('button', { name: '阅读 升级保留测试' }).click();
      await expect(page.getByRole('button', { name: '在当前位置添加书签' })).toBeEnabled();
      await expect(page.frameLocator('iframe').locator('body')).toContainText('风从书页间经过');
      await expect(page.frameLocator('iframe').locator('body')).toHaveCSS('font-size', '26px');
      await page.getByRole('button', { name: /^书签/ }).click();
      await page.getByRole('button', { name: /保留书签/ }).click();
      await expect(page.getByLabel('书签备注', { exact: true })).toHaveValue('升级后仍在的独立备注');
    }
  } finally { await app.close(); }
  console.log(`Upgrade ${stage} verification passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
