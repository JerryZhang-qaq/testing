const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const JSZip = require('jszip');
const { XMLParser, XMLValidator } = require('fast-xml-parser');

const MAX_FILE_SIZE = 150 * 1024 * 1024;
const MAX_UNPACKED_SIZE = 600 * 1024 * 1024;
const MAX_XML_SIZE = 4 * 1024 * 1024;
const DEFAULT_SETTINGS = Object.freeze({
  theme: 'paper', font: 'serif', fontSize: 20, lineHeight: 1.8,
  background: '#f5f9fc', foreground: '#263746',
});
const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true,
  parseTagValue: false, trimValues: true,
});
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const text = value => typeof value === 'object' && value ? String(value['#text'] ?? '') : String(value ?? '');
const clip = (value, limit) => String(value ?? '').slice(0, limit);
const fail = message => { throw new Error(message); };

function archivePath(base, href) {
  let decoded;
  try { decoded = decodeURIComponent(String(href).split('#')[0]); }
  catch { fail('书籍内部资源路径无效。'); }
  if (decoded.includes('\\') || decoded.includes('\0') || /^[a-z]+:/i.test(decoded) || decoded.startsWith('/')) {
    fail('书籍内部资源路径不安全。');
  }
  const result = path.posix.normalize(path.posix.join(base, decoded));
  if (result === '..' || result.startsWith('../')) fail('书籍内部资源路径越界。');
  return result;
}

async function readXml(zip, name) {
  const entry = zip.file(name);
  if (!entry) fail(`缺少 EPUB 文件：${name}`);
  if (entry._data.uncompressedSize > MAX_XML_SIZE) fail('书籍元数据过大。');
  const xml = await entry.async('string');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail('书籍元数据包含不支持的外部实体。');
  if (XMLValidator.validate(xml) !== true) fail('书籍 XML 元数据损坏。');
  return parser.parse(xml);
}

async function parseEpub(buffer, fileName = '未命名.epub') {
  if (!buffer.length || buffer.length > MAX_FILE_SIZE) fail('请选择不超过 150 MB 的 EPUB 文件。');
  let zip;
  try { zip = await JSZip.loadAsync(buffer); }
  catch { fail('文件不是有效的 EPUB 压缩包，或已损坏。'); }
  const entries = Object.values(zip.files);
  if (entries.length > 20000 || entries.reduce((sum, e) => sum + (e._data?.uncompressedSize ?? 0), 0) > MAX_UNPACKED_SIZE) {
    fail('EPUB 解压后的内容过大，无法安全导入。');
  }
  const mimetype = zip.file('mimetype');
  if (mimetype && (mimetype._data.uncompressedSize > 100 || (await mimetype.async('string')).trim() !== 'application/epub+zip')) {
    fail('文件的 EPUB 类型标记无效。');
  }
  if (zip.file('META-INF/encryption.xml')) {
    const encrypted = await readXml(zip, 'META-INF/encryption.xml');
    const methods = list(encrypted.encryption?.EncryptedData).map(e => e.EncryptionMethod?.['@_Algorithm']);
    const fontAlgorithms = ['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'];
    if (methods.some(method => !fontAlgorithms.includes(method))) fail('这本书使用 DRM 加密，需要对应的授权阅读器。');
  }
  const container = await readXml(zip, 'META-INF/container.xml');
  const roots = list(container.container?.rootfiles?.rootfile);
  const root = roots.find(r => r['@_media-type'] === 'application/oebps-package+xml') ?? roots[0];
  if (!root?.['@_full-path']) fail('找不到 EPUB 内容清单。');
  const opfPath = archivePath('', root['@_full-path']);
  const opf = (await readXml(zip, opfPath)).package;
  if (!opf?.manifest || !opf?.spine) fail('EPUB 缺少内容清单或章节顺序。');
  const manifest = list(opf.manifest.item);
  const spine = list(opf.spine.itemref);
  if (!spine.length || !spine.some(ref => manifest.some(item => item['@_id'] === ref['@_idref'] && zip.file(archivePath(path.posix.dirname(opfPath), item['@_href']))))) {
    fail('EPUB 没有可以阅读的章节。');
  }
  const metadata = opf.metadata ?? {};
  const meta = list(metadata.meta);
  const calibreSeries = meta.find(m => m['@_name'] === 'calibre:series');
  const collection = meta.find(m => m['@_property'] === 'belongs-to-collection' && (
    !m['@_id'] || meta.some(t => t['@_refines'] === `#${m['@_id']}` && t['@_property'] === 'collection-type' && text(t) === 'series')
  ));
  const series = text(calibreSeries?.['@_content'] ?? collection);
  const sequence = meta.find(m => m['@_name'] === 'calibre:series_index')?.['@_content'] ??
    meta.find(m => m['@_property'] === 'group-position' && m['@_refines'] === `#${collection?.['@_id']}`)?.['#text'];
  const coverId = meta.find(m => m['@_name'] === 'cover')?.['@_content'];
  const coverItem = manifest.find(item => String(item['@_properties'] ?? '').split(/\s+/).includes('cover-image')) ??
    manifest.find(item => item['@_id'] === coverId);
  const base = path.posix.dirname(opfPath);
  const imageTypes = /^(image\/(jpeg|png|gif|webp|svg\+xml|avif))$/;
  async function imageCover(name, mime) {
    const image = zip.file(name);
    if (!image || !imageTypes.test(mime ?? '') || image._data.uncompressedSize > 8 * 1024 * 1024) return null;
    return `data:${mime};base64,${await image.async('base64')}`;
  }
  let cover = null;
  if (coverItem) {
    try { cover = await imageCover(archivePath(base, coverItem['@_href']), coverItem['@_media-type']); } catch {}
  }
  if (!cover) {
    // Follow actual reading order, rather than ZIP or manifest order.
    const orderedParser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, preserveOrder: true });
    function imageRefs(nodes) {
      const refs = [];
      for (const node of nodes) {
        const attrs = node[':@'] ?? {};
        if ('img' in node || 'image' in node) refs.push(attrs['@_src'] ?? attrs['@_href']);
        for (const [key, value] of Object.entries(node)) if (key !== ':@' && Array.isArray(value)) refs.push(...imageRefs(value));
      }
      return refs.filter(Boolean);
    }
    for (const ref of spine) {
      const chapter = manifest.find(item => item['@_id'] === ref['@_idref']);
      if (!chapter) continue;
      try {
        const chapterPath = archivePath(base, chapter['@_href']);
        const entry = zip.file(chapterPath);
        if (!entry || entry._data.uncompressedSize > MAX_XML_SIZE) continue;
        const xml = await entry.async('string');
        if (/<!DOCTYPE|<!ENTITY/i.test(xml)) continue;
        for (const href of imageRefs(orderedParser.parse(xml))) {
          try {
            const name = archivePath(path.posix.dirname(chapterPath), href);
            const item = manifest.find(item => { try { return archivePath(base, item['@_href']) === name; } catch { return false; } });
            cover = await imageCover(name, item?.['@_media-type'] ?? ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif' })[path.posix.extname(name).toLowerCase()]);
          } catch {}
          if (cover) break;
        }
      } catch {}
      if (cover) break;
    }
    if (!cover) for (const item of manifest) {
      if (!imageTypes.test(item['@_media-type'] ?? '')) continue;
      try { cover = await imageCover(archivePath(base, item['@_href']), item['@_media-type']); } catch {}
      if (cover) break;
    }
  }
  return {
    title: clip(text(list(metadata.title)[0]) || path.basename(fileName, path.extname(fileName)), 500),
    author: clip(list(metadata.creator).map(text).filter(Boolean).join('、') || '未知作者', 500),
    language: clip(text(list(metadata.language)[0]), 30),
    series: clip(series, 200),
    seriesIndex: Number.isFinite(Number(sequence)) ? Number(sequence) : 0,
    cover, originalFileName: clip(fileName, 500),
  };
}

function normalizeSettings(settings) {
  const color = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
  return {
    theme: ['paper', 'white', 'night', 'custom'].includes(settings.theme) ? settings.theme : 'paper',
    font: ['original', 'serif', 'sans', 'kai'].includes(settings.font) ? settings.font : 'serif',
    fontSize: Math.max(14, Math.min(36, Number(settings.fontSize) || 20)),
    lineHeight: Math.max(1.3, Math.min(2.4, Number(settings.lineHeight) || 1.8)),
    background: color(settings.background) ? settings.background : DEFAULT_SETTINGS.background,
    foreground: color(settings.foreground) ? settings.foreground : DEFAULT_SETTINGS.foreground,
  };
}

class Library {
  constructor(root) {
    this.root = root;
    this.state = { version: 1, books: [], series: [], settings: { ...DEFAULT_SETTINGS } };
    this.queue = Promise.resolve();
  }
  async init() {
    await fs.mkdir(path.join(this.root, 'books'), { recursive: true });
    try {
      const saved = JSON.parse(await fs.readFile(path.join(this.root, 'library.json'), 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.books)) fail('书库数据版本不兼容。');
      this.state = { ...saved, settings: normalizeSettings(saved.settings ?? {}) };
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`书库无法读取，原数据已保留：${error.message}`);
    }
    this.state.series = Array.isArray(this.state.series) ? this.state.series : [];
    for (const book of this.state.books) if (book.series && !this.state.series.some(item => item.name === book.series)) {
      this.state.series.push({ name: book.series, mode: 'auto', order: [] });
    }
    // Upgrade existing imported books too; never replace user data when an EPUB is unavailable.
    let upgraded = false;
    for (const book of this.state.books.filter(book => !book.cover)) {
      try {
        const metadata = await parseEpub(await this.readBook(book.id));
        if (metadata.cover) { book.cover = metadata.cover; upgraded = true; }
      } catch {}
    }
    if (upgraded) await this.change(() => {});
    return this;
  }
  snapshot() { return structuredClone(this.state); }
  change(action) {
    const operation = this.queue.then(async () => {
      const previous = structuredClone(this.state);
      try {
        const result = await action();
        const temporary = path.join(this.root, 'library.json.tmp');
        await fs.writeFile(temporary, JSON.stringify(this.state, null, 2), 'utf8');
        await fs.rename(temporary, path.join(this.root, 'library.json'));
        return result;
      } catch (error) { this.state = previous; throw error; }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  book(id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) fail('书籍 ID 无效。');
    const book = this.state.books.find(b => b.id === id);
    if (!book) fail('书籍已不存在。');
    return book;
  }
  async importFiles(paths) {
    const result = { added: 0, duplicate: 0, errors: [] };
    for (const file of paths) {
      try {
        if (path.extname(file).toLowerCase() !== '.epub') fail('只支持 EPUB 文件。');
        const stat = await fs.stat(file);
        if (!stat.isFile() || stat.size > MAX_FILE_SIZE) fail('请选择不超过 150 MB 的 EPUB 文件。');
        const buffer = await fs.readFile(file);
        const id = crypto.createHash('sha256').update(buffer).digest('hex');
        if (this.state.books.some(b => b.id === id)) { result.duplicate++; continue; }
        const metadata = await parseEpub(buffer, path.basename(file));
        await this.change(async () => {
          if (this.state.books.some(b => b.id === id)) { result.duplicate++; return; }
          await fs.writeFile(path.join(this.root, 'books', `${id}.epub`), buffer);
          if (metadata.series) this.ensureSeries(metadata.series);
          this.state.books.push({ id, ...metadata, importedAt: Date.now(), lastReadAt: 0, progress: 0, cfi: '', bookmarks: [] });
          result.added++;
        });
      } catch (error) { result.errors.push({ file: path.basename(file), message: error.message }); }
    }
    return { ...result, state: this.snapshot() };
  }
  async readBook(id) {
    this.book(id);
    return fs.readFile(path.join(this.root, 'books', `${id}.epub`));
  }
  updateBook(id, patch) {
    return this.change(() => {
      const book = this.book(id);
      if ('series' in patch) {
        const previous = book.series;
        book.series = clip(patch.series, 200).trim();
        if (previous !== book.series) {
          const old = this.state.series.find(item => item.name === previous);
          if (old) old.order = old.order.filter(id => id !== book.id);
          if (book.series) this.ensureSeries(book.series).order.push(book.id);
        }
      }
      if ('seriesIndex' in patch) book.seriesIndex = Math.max(0, Math.min(99999, Number(patch.seriesIndex) || 0));
      if ('cfi' in patch) {
        if (typeof patch.cfi !== 'string' || !patch.cfi.startsWith('epubcfi(') || patch.cfi.length > 4000) fail('阅读位置无效。');
        book.cfi = patch.cfi;
        book.lastReadAt = Date.now();
      }
      if ('progress' in patch) book.progress = Math.max(0, Math.min(1, Number(patch.progress) || 0));
      return structuredClone(book);
    });
  }
  ensureSeries(name) {
    let item = this.state.series.find(item => item.name === name);
    if (!item) { item = { name, mode: 'auto', order: [] }; this.state.series.push(item); }
    return item;
  }
  createSeries(name) {
    return this.change(() => {
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 200) fail('请输入不超过 200 字的系列名称。');
      this.ensureSeries(name.trim());
      return this.snapshot();
    });
  }
  saveSeries(name, mode, order) {
    return this.change(() => {
      const item = this.state.series.find(item => item.name === name);
      if (!item || !['auto', 'manual'].includes(mode)) fail('系列或排序模式无效。');
      const members = this.state.books.filter(book => book.series === name).map(book => book.id);
      if (mode === 'manual') {
        if (!Array.isArray(order) || order.length !== members.length || new Set(order).size !== members.length || order.some(id => !members.includes(id))) fail('系列成员已变化，请重新排序。');
        item.order = [...order];
      }
      item.mode = mode;
      return this.snapshot();
    });
  }
  saveSettings(settings) {
    return this.change(() => {
      this.state.settings = normalizeSettings({ ...this.state.settings, ...settings });
      return { ...this.state.settings };
    });
  }
  saveBookmark(id, input) {
    return this.change(() => {
      const book = this.book(id);
      if (typeof input.cfi !== 'string' || !input.cfi.startsWith('epubcfi(') || input.cfi.length > 4000) fail('书签位置无效。');
      let bookmark = input.id ? book.bookmarks.find(b => b.id === input.id) : null;
      if (input.id && !bookmark) fail('书签已不存在。');
      if (!bookmark) {
        bookmark = { id: crypto.randomUUID(), createdAt: Date.now() };
        book.bookmarks.push(bookmark);
      }
      Object.assign(bookmark, { cfi: input.cfi, chapter: clip(input.chapter, 500), title: clip(input.title, 200), note: clip(input.note, 10000), updatedAt: Date.now() });
      return structuredClone(book);
    });
  }
  deleteBookmark(id, bookmarkId) {
    return this.change(() => {
      const book = this.book(id);
      book.bookmarks = book.bookmarks.filter(b => b.id !== bookmarkId);
      return structuredClone(book);
    });
  }
  deleteBook(id) {
    return this.change(async () => {
      this.book(id);
      // Persist removal before cleaning the file. A failed disk write must retain the book.
      for (const item of this.state.series) item.order = item.order.filter(bookId => bookId !== id);
      this.state.books = this.state.books.filter(b => b.id !== id);
      return this.snapshot();
    }).then(async state => {
      await fs.unlink(path.join(this.root, 'books', `${id}.epub`)).catch(error => {
        if (error.code !== 'ENOENT') console.warn('Unused book file could not be cleaned up.');
      });
      return state;
    });
  }
}

module.exports = { Library, parseEpub, DEFAULT_SETTINGS, archivePath };
