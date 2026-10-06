const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { Library, parseEpub, archivePath } = require('../electron/library.cjs');
const { fixture } = require('./fixtures.cjs');
const cfi = 'epubcfi(/6/2[ch1]!/4/2/1:0)';

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lanread-unit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const library = await new Library(path.join(root, 'data')).init();
  const file = path.join(root, 'book.epub');
  await fs.writeFile(file, await fixture());
  return { root, library, file };
}

test('EPUB 3: cover, Unicode author and refined series position', async () => {
  const metadata = await parseEpub(await fixture({ index: 1.5 }));
  assert.equal(metadata.title, '风与书页');
  assert.equal(metadata.author, '林间');
  assert.equal(metadata.series, '蓝色故事');
  assert.equal(metadata.seriesIndex, 1.5);
  assert.match(metadata.cover, /^data:image\/svg\+xml;base64,/);
});
test('EPUB 2: Calibre series and NCX package', async () => {
  const metadata = await parseEpub(await fixture({ version: 2, index: 2, cover: false }));
  assert.equal(metadata.seriesIndex, 2);
  assert.equal(metadata.cover, null);
  assert.equal(metadata.series, '蓝色故事');
});
test('Missing metadata uses title and author fallbacks', async () => {
  const zip = await JSZip.loadAsync(await fixture({ series: '' }));
  zip.file('OEBPS/content.opf', (await zip.file('OEBPS/content.opf').async('string')).replace(/<dc:title>.*?<\/dc:title>|<dc:creator>.*?<\/dc:creator>/g, ''));
  const metadata = await parseEpub(await zip.generateAsync({ type: 'nodebuffer' }), '本地文件.epub');
  assert.equal(metadata.title, '本地文件');
  assert.equal(metadata.author, '未知作者');
});
test('Invalid ZIP and DRM return actionable errors', async () => {
  await assert.rejects(parseEpub(Buffer.from('not a zip')), /压缩包/);
  await assert.rejects(parseEpub(await fixture({ drm: true })), /DRM/);
});
test('Archive paths reject traversal and external resources', () => {
  assert.equal(archivePath('OEBPS', 'images/%E5%B0%81%E9%9D%A2.png'), 'OEBPS/images/封面.png');
  assert.throws(() => archivePath('', '../secret'), /越界/);
  assert.throws(() => archivePath('', 'https://example.com/book'), /不安全/);
});
test('Bad XML and missing reading chapters cannot enter the library', async () => {
  const zip = await JSZip.loadAsync(await fixture());
  zip.file('META-INF/container.xml', '<container>');
  await assert.rejects(parseEpub(await zip.generateAsync({ type: 'nodebuffer' })), /XML/);
  const other = await JSZip.loadAsync(await fixture());
  other.remove('OEBPS/chapter1.xhtml');
  other.remove('OEBPS/chapter2.xhtml');
  await assert.rejects(parseEpub(await other.generateAsync({ type: 'nodebuffer' })), /章节/);
});
test('Import copies original, deduplicates by content and survives original removal', async t => {
  const { library, file } = await setup(t);
  const first = await library.importFiles([file, file]);
  assert.equal(first.added, 1);
  assert.equal(first.duplicate, 1);
  assert.equal(first.state.books.length, 1);
  await fs.unlink(file);
  assert.ok((await library.readBook(first.state.books[0].id)).length > 0);
});
test('Batch import keeps valid books when another file is damaged', async t => {
  const { library, file, root } = await setup(t);
  const broken = path.join(root, 'broken.epub');
  await fs.writeFile(broken, 'bad');
  const result = await library.importFiles([broken, file]);
  assert.equal(result.added, 1);
  assert.equal(result.errors.length, 1);
});
test('Series, reading position and settings are restored from disk', async t => {
  const { library, file } = await setup(t);
  const id = (await library.importFiles([file])).state.books[0].id;
  await library.updateBook(id, { series: '手动系列', seriesIndex: 3.5, cfi, progress: .42 });
  await library.saveSettings({ font: 'sans', fontSize: 26, background: '#aabbcc', theme: 'custom' });
  const restored = (await new Library(library.root).init()).snapshot();
  assert.equal(restored.books[0].series, '手动系列');
  assert.equal(restored.books[0].seriesIndex, 3.5);
  assert.equal(restored.books[0].cfi, cfi);
  assert.equal(restored.books[0].progress, .42);
  assert.equal(restored.settings.fontSize, 26);
  assert.equal(restored.settings.background, '#aabbcc');
});
test('Multiple bookmarks at the same position keep independent editable notes', async t => {
  const { library, file } = await setup(t);
  const id = (await library.importFiles([file])).state.books[0].id;
  await library.saveBookmark(id, { cfi, chapter: '第一章', title: '甲', note: '甲备注' });
  let book = await library.saveBookmark(id, { cfi, chapter: '第一章', title: '乙', note: '乙备注' });
  const first = book.bookmarks[0];
  book = await library.saveBookmark(id, { ...first, note: '甲的新备注' });
  assert.equal(book.bookmarks[1].note, '乙备注');
  assert.equal(book.bookmarks[0].note, '甲的新备注');
  const restored = (await new Library(library.root).init()).snapshot();
  assert.equal(restored.books[0].bookmarks.length, 2);
  book = await library.deleteBookmark(id, first.id);
  assert.equal(book.bookmarks[0].title, '乙');
});
test('Concurrent notes and progress writes do not lose changes', async t => {
  const { library, file } = await setup(t);
  const id = (await library.importFiles([file])).state.books[0].id;
  await Promise.all([
    library.saveBookmark(id, { cfi, title: 'A', note: 'one' }),
    library.updateBook(id, { cfi, progress: .5 }),
    library.saveBookmark(id, { cfi, title: 'B', note: 'two' }),
  ]);
  const restored = (await new Library(library.root).init()).snapshot().books[0];
  assert.equal(restored.bookmarks.length, 2);
  assert.equal(restored.progress, .5);
});
test('Deleting a book removes the copy and data but keeps the original', async t => {
  const { library, file } = await setup(t);
  const id = (await library.importFiles([file])).state.books[0].id;
  const state = await library.deleteBook(id);
  assert.equal(state.books.length, 0);
  assert.ok(await fs.stat(file));
  await assert.rejects(fs.stat(path.join(library.root, 'books', `${id}.epub`)), { code: 'ENOENT' });
});
test('Corrupted library data is preserved instead of overwritten', async t => {
  const { library } = await setup(t);
  const file = path.join(library.root, 'library.json');
  await fs.writeFile(file, '{broken');
  await assert.rejects(new Library(library.root).init(), /原数据已保留/);
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
});
test('Settings and invalid file IDs are validated', async t => {
  const { library } = await setup(t);
  const settings = await library.saveSettings({ fontSize: 999, background: 'url(x)', font: 'bad' });
  assert.equal(settings.fontSize, 36);
  assert.equal(settings.background, '#f5f9fc');
  assert.equal(settings.font, 'serif');
  await assert.rejects(library.readBook('../other'), /ID/);
});

test('Cover fallback follows spine and image appearance, skipping remote and missing references', async () => {
  const zip = await JSZip.loadAsync(await fixture({ cover: false }));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=', 'base64');
  zip.file('OEBPS/second.png', Buffer.from('second'));
  zip.file('OEBPS/first.png', png);
  let opf = await zip.file('OEBPS/content.opf').async('string');
  zip.file('OEBPS/content.opf', opf.replace('</manifest>', '<item id="second" href="second.png" media-type="image/png"/><item id="first" href="first.png" media-type="image/png"/></manifest>'));
  let chapter = await zip.file('OEBPS/chapter1.xhtml').async('string');
  zip.file('OEBPS/chapter1.xhtml', chapter.replace('<body>', '<body><img src="https://example.com/remote.png"/><img src="missing.png"/><svg xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="first.png"/></svg><img src="second.png"/>'));
  const parsed = await parseEpub(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.equal(parsed.cover, `data:image/png;base64,${png.toString('base64')}`);
});

test('Declared covers take precedence over first illustration', async () => {
  const zip = await JSZip.loadAsync(await fixture());
  zip.file('OEBPS/illustration.png', Buffer.from('illustration'));
  zip.file('OEBPS/chapter1.xhtml', (await zip.file('OEBPS/chapter1.xhtml').async('string')).replace('<body>', '<body><img src="illustration.png"/>'));
  assert.match((await parseEpub(await zip.generateAsync({ type: 'nodebuffer' }))).cover, /^data:image\/svg\+xml/);
});

test('Old libraries gain fallback covers without losing bookmarks or original copies', async t => {
  const { library, file } = await setup(t);
  const book = (await library.importFiles([file])).state.books[0];
  await library.saveBookmark(book.id, { cfi, title: '保留', note: '保留备注' });
  const saved = library.snapshot();
  saved.books[0].cover = null;
  delete saved.series;
  await fs.writeFile(path.join(library.root, 'library.json'), JSON.stringify(saved));
  const restored = (await new Library(library.root).init()).snapshot();
  assert.ok(restored.books[0].cover);
  assert.equal(restored.books[0].bookmarks[0].note, '保留备注');
  assert.equal(restored.series[0].name, '蓝色故事');
});

test('Empty series, membership and validated manual orders persist atomically', async t => {
  const { library, root, file } = await setup(t);
  const other = path.join(root, 'other.epub');
  await fs.writeFile(other, await fixture({ title: '第二卷', index: 2 }));
  const books = (await library.importFiles([file, other])).state.books;
  await library.createSeries('新书架');
  await library.updateBook(books[0].id, { series: '新书架' });
  await library.updateBook(books[1].id, { series: '新书架' });
  const order = [books[1].id, books[0].id];
  await library.saveSeries('新书架', 'manual', order);
  await assert.rejects(library.saveSeries('新书架', 'manual', [books[0].id, books[0].id]), /成员/);
  let restored = (await new Library(library.root).init()).snapshot();
  assert.deepEqual(restored.series.find(item => item.name === '新书架').order, order);
  assert.equal(restored.series.find(item => item.name === '新书架').mode, 'manual');
  await library.updateBook(books[0].id, { series: '' });
  await library.saveSeries('新书架', 'auto');
  restored = library.snapshot();
  assert.equal(restored.series.find(item => item.name === '新书架').mode, 'auto');
  assert.deepEqual(restored.series.find(item => item.name === '新书架').order, [books[1].id]);
});
