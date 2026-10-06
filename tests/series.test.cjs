const { test } = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../src/series.ts');
const book = (id, title, seriesIndex = 0, originalFileName = '') => ({ id, title, seriesIndex, originalFileName });
test('Auto order prioritizes explicit indices and understands Chinese, English, full width and filename numbering', async () => {
  const { inferredIndex, sortSeriesBooks } = await modulePromise;
  for (const [title, value] of [['第十二卷', 12], ['第三十一册', 31], ['第两百零一卷', 201], ['Vol. ０２', 2], ['Book 10', 10], ['作品 03', 3]]) assert.equal(inferredIndex(book('a', title)), value);
  assert.equal(inferredIndex(book('a', '无编号', 0, '作品_02.epub')), 2);
  assert.equal(inferredIndex(book('a', '第十二卷', 1.5)), 1.5);
  const books = [book('c', '第十二卷'), book('b', '第二册'), book('x', '番外'), book('a', '作品10', 1)];
  assert.deepEqual(sortSeriesBooks(books).map(b => b.id), ['a', 'b', 'c', 'x']);
  assert.deepEqual(sortSeriesBooks([book('b', '作品10'), book('a', '作品2')]).map(b => b.id), ['a', 'b']);
});
test('Manual order overrides indices, appends new members and switching to auto restores numbering', async () => {
  const { sortSeriesBooks } = await modulePromise;
  const books = [book('a', '甲', 1), book('b', '乙', 2), book('c', '丙', 3)];
  const series = { name: '故事', mode: 'manual', order: ['b', 'a'] };
  assert.deepEqual(sortSeriesBooks(books, series).map(b => b.id), ['b', 'a', 'c']);
  assert.deepEqual(sortSeriesBooks(books, { ...series, mode: 'auto' }).map(b => b.id), ['a', 'b', 'c']);
});
