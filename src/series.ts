import type { BookRecord, SeriesRecord } from './types';

function chineseNumber(value: string): number {
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (!/[十百千]/.test(value)) return Number([...value].map(c => digits[c]).join(''));
  let total = 0, digit = 0;
  for (const c of value) {
    const unit = ({ 十: 10, 百: 100, 千: 1000 } as Record<string, number>)[c];
    if (unit) { total += (digit || 1) * unit; digit = 0; } else digit = digits[c];
  }
  return total + digit;
}
export function inferredIndex(book: BookRecord): number | null {
  if (book.seriesIndex > 0) return book.seriesIndex;
  for (const raw of [book.title, book.originalFileName ?? '']) {
    const title = raw.normalize('NFKC');
    const match = title.match(/第\s*([\d零〇一二两三四五六七八九十百千]+(?:\.\d+)?)\s*[卷册部集本话]/i)
      ?? title.match(/(?:vol(?:ume)?\.?|book|part|卷|册)\s*([0-9]+(?:\.[0-9]+)?)/i)
      ?? title.match(/(?:^|[\s_\-([【（])([0-9]+)(?=$|[\s_\-).\]】）卷册])/);
    if (match) return /^\d/.test(match[1]) ? Number(match[1]) : chineseNumber(match[1]);
  }
  return null;
}
const names = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
export function sortSeriesBooks(books: BookRecord[], series?: SeriesRecord): BookRecord[] {
  const positions = new Map(series?.order.map((id, index) => [id, index]));
  return [...books].sort((a, b) => {
    if (series?.mode === 'manual') {
      const difference = (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity);
      if (difference) return difference;
    }
    const difference = (inferredIndex(a) ?? Infinity) - (inferredIndex(b) ?? Infinity);
    return (Number.isNaN(difference) ? 0 : difference) || names.compare(a.title, b.title) || a.id.localeCompare(b.id);
  });
}
