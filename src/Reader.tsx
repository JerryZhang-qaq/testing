import { useEffect, useRef, useState } from 'react';
import ePub, { type Book, type Rendition, type Contents } from 'epubjs';
import type { Location } from 'epubjs/types/rendition';
import type { NavItem } from 'epubjs/types/navigation';
import { ArrowLeft, List, Bookmark as BookmarkIcon, BookmarkPlus, Type, ChevronLeft, ChevronRight, X, Trash2, LoaderCircle, Check, AlertCircle } from 'lucide-react';
import { Appearance } from './components';
import type { BookRecord, Bookmark, BookmarkInput, LanreadAPI, Settings } from './types';

type Props = {
  book: BookRecord; settings: Settings; api: LanreadAPI;
  updateBook: (book: BookRecord) => void;
  updateSettings: (settings: Partial<Settings>) => void;
  back: () => void; notify: (message: string) => void;
};
type Chapter = NavItem & { depth: number };
const flatten = (items: NavItem[], depth = 0): Chapter[] => items.flatMap(item => [{ ...item, depth }, ...flatten(item.subitems ?? [], depth + 1)]);
const fontFamilies: Record<Settings['font'], string> = {
  original: '', serif: '"Source Han Serif SC", "Noto Serif CJK SC", "SimSun", serif',
  sans: '"Microsoft YaHei", "Noto Sans CJK SC", sans-serif', kai: '"KaiTi", "STKaiti", "SimSun", serif',
};
const errorMessage = (error: unknown) => error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error || '未知错误');

function applyAppearance(rendition: Rendition, settings: Settings) {
  const rules: Record<string, Record<string, string>> = {
    'body': { color: `${settings.foreground} !important`, background: `${settings.background} !important`, 'font-size': `${settings.fontSize}px !important`, 'line-height': `${settings.lineHeight} !important` },
    'p, li, blockquote': { 'font-size': '1em !important', 'line-height': `${settings.lineHeight} !important`, color: 'inherit !important' },
    'a': { color: 'inherit !important' },
    'img, svg': { 'max-width': '100% !important', 'object-fit': 'contain' },
  };
  if (settings.font !== 'original') rules['body, p, li, blockquote'] = { 'font-family': `${fontFamilies[settings.font]} !important` };
  rendition.themes.register('lanread', rules);
  rendition.themes.select('lanread');
  // Replace the existing theme sheet too; registering the same name is not enough for already-open chapters.
  const contents = rendition.getContents() as unknown as Contents[];
  for (const content of contents) {
    const style = content.document.getElementById('lanread-appearance') ?? content.document.createElement('style');
    style.id = 'lanread-appearance';
    style.textContent = Object.entries(rules).map(([selector, declarations]) => `${selector}{${Object.entries(declarations).map(([key, value]) => `${key}:${value};`).join('')}}`).join('\n');
    if (!style.parentElement) content.document.head.appendChild(style);
  }
}

function BookmarkEditor({ bookmark, save, remove, jump, disabled = false }: { bookmark: Bookmark; save: (value: BookmarkInput) => Promise<void>; remove: () => void; jump: () => void; disabled?: boolean }) {
  const [title, setTitle] = useState(bookmark.title);
  const [note, setNote] = useState(bookmark.note);
  const [status, setStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const draft = useRef({ title: bookmark.title, note: bookmark.note });
  const sequence = useRef(0);
  const persist = async (patch: { title?: string; note?: string }) => {
    draft.current = { ...draft.current, ...patch };
    const version = ++sequence.current;
    setStatus('saving');
    try {
      await save({ ...bookmark, ...draft.current });
      if (version === sequence.current) setStatus('saved');
    } catch { if (version === sequence.current) setStatus('error'); }
  };
  return <div className="bookmark-editor">
    <div className="bookmark-editor-heading"><span>书签备注</span><span className={`save-status ${status}`} aria-live="polite">{status === 'saved' ? <><Check size={12} />已保存</> : status === 'saving' ? '保存中…' : '保存失败'}</span></div>
    <label className="field">标题<input aria-label="书签标题" disabled={disabled} maxLength={200} value={title} placeholder="给这根书签起个名字" onChange={e => { setTitle(e.target.value); void persist({ title: e.target.value }); }} /></label>
    <label className="field">独立备注<textarea aria-label="书签备注" disabled={disabled} maxLength={10000} rows={7} value={note} placeholder="写下此刻的想法…" onChange={e => { setNote(e.target.value); void persist({ note: e.target.value }); }} /></label>
    <div className="bookmark-meta">{bookmark.chapter || '正文'} · {new Date(bookmark.createdAt).toLocaleDateString('zh-CN')}</div>
    <div className="editor-actions"><button className="secondary" onClick={jump}>跳到此处</button><button className="icon-button danger-text" aria-label="删除当前书签" onClick={remove}><Trash2 size={17} /></button></div>
    {status === 'error' && <button className="secondary" onClick={() => void persist({})}>重试保存</button>}
  </div>;
}

export function Reader({ book, settings, api, updateBook, updateSettings, back, notify }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<Book | null>(null);
  const rendition = useRef<Rendition | null>(null);
  const current = useRef<Location | null>(null);
  const props = useRef({ book, settings, updateBook, notify });
  props.current = { book, settings, updateBook, notify };
  const [panel, setPanel] = useState<'toc' | 'bookmarks' | 'appearance' | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [chapter, setChapter] = useState('正在加载…');
  const [progress, setProgress] = useState(book.progress);
  const [ready, setReady] = useState(false);
  const [locationsReady, setLocationsReady] = useState(false);
  const [error, setError] = useState('');
  const [selectedBookmark, setSelectedBookmark] = useState<string | null>(null);
  const [page, setPage] = useState({ current: 1, total: 1 });
  const [edges, setEdges] = useState({ start: true, end: false });
  const [adding, setAdding] = useState(false);
  const [turning, setTurning] = useState(false);

  useEffect(() => {
    let disposed = false;
    let instance: Book | null = null;
    let view: Rendition | null = null;
    let navigation: Chapter[] = [];
    let generated = false;
    let generationTask: Promise<unknown> | null = null;
    const persist = (location: Location) => {
      if (disposed || !location?.start?.cfi) return;
      current.current = location;
      const title = navigation.find(item => item.href.split('#')[0] === location.start.href.split('#')[0])?.label || '正文';
      setChapter(title.trim());
      setPage({ current: location.start.displayed.page, total: location.start.displayed.total });
      setEdges({ start: location.atStart, end: location.atEnd });
      const percentage = generated && instance ? Math.max(0, instance.locations.percentageFromCfi(location.start.cfi)) : props.current.book.progress;
      setProgress(percentage);
      api.updateBook(book.id, { cfi: location.start.cfi, ...(generated ? { progress: percentage } : {}) }).then(props.current.updateBook).catch(e => props.current.notify(`进度保存失败：${e.message}`));
    };
    const start = async () => {
      try {
        const buffer = await api.readBook(book.id);
        if (disposed) return;
        instance = ePub({ replacements: 'blobUrl' });
        engine.current = instance;
        // Catch ready/open failures, including EPUBs with a missing resource.
        instance.ready.catch(() => {});
        await instance.open(buffer, 'binary');
        if (disposed) return;
        await instance.ready;
        navigation = flatten((await instance.loaded.navigation).toc);
        setChapters(navigation);
        if (!host.current) return;
        view = instance.renderTo(host.current, { width: '100%', height: '100%', flow: 'paginated', spread: 'none', allowScriptedContent: false });
        rendition.current = view;
        view.hooks.content.register((content: Contents) => {
          if (disposed || !view) return;
          // Ebooks never run their own scripts. Keyboard events in the isolated reading frame are forwarded.
          content.document.addEventListener('keydown', keyboard);
          content.document.documentElement.lang ||= props.current.book.language || 'zh-CN';
          applyAppearance(view, props.current.settings);
        });
        view.on('rendered', () => {
          if (view && !disposed) {
            applyAppearance(view, props.current.settings);
            host.current?.querySelectorAll('iframe').forEach(frame => frame.title = `${props.current.book.title} 正文`);
          }
        });
        view.on('relocated', persist);
        view.on('displayError', (e: Error) => { if (!disposed) setError(`章节无法打开：${e.message}`); });
        applyAppearance(view, props.current.settings);
        try { await view.display(book.cfi || undefined); }
        catch (initialError) {
          if (!book.cfi) throw initialError;
          props.current.notify('原阅读位置无法恢复，已打开书籍起始处。');
          await view.display();
        }
        if (disposed) return;
        setReady(true);
        generationTask = instance.locations.generate(1200).then(() => {
          if (disposed) return;
          generated = true;
          setLocationsReady(true);
          if (current.current) persist(current.current);
        }).catch(() => { if (!disposed) props.current.notify('百分比暂不可用；阅读位置与书签仍可保存。'); });
      } catch (e) { if (!disposed) { console.error('EPUB opening failed:', e); setError(errorMessage(e)); } }
    };
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, [contenteditable="true"]')) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const operation = event.key === 'ArrowRight' ? view?.next() : view?.prev();
        operation?.catch(e => props.current.notify(`翻页失败：${e.message}`));
      }
    };
    document.addEventListener('keydown', keyboard);
    const startupTask = start();
    return () => {
      disposed = true;
      document.removeEventListener('keydown', keyboard);
      rendition.current = null;
      engine.current = null;
      // Wait for in-flight archive reads before destroying it. Clear queued chapters so a quick
      // return to the library does not keep indexing the rest of a large book in the background.
      void startupTask.catch(() => {}).then(async () => {
        const queue = instance?.locations as unknown as { q?: { clear(): void } } | undefined;
        queue?.q?.clear();
        if (generationTask) await generationTask.catch(() => {});
        instance?.destroy();
      });
    };
  }, [book.id, api]);

  useEffect(() => {
    if (!ready || !rendition.current) return;
    const cfi = current.current?.start.cfi;
    applyAppearance(rendition.current, settings);
    // Restore the content position after typography changes instead of keeping an old page number.
    if (cfi) rendition.current.display(cfi).catch(e => notify(`排版调整失败：${e.message}`));
  }, [settings, ready]);
  useEffect(() => {
    if (!host.current || !ready) return;
    const observer = new ResizeObserver(() => rendition.current?.resize(host.current!.clientWidth, host.current!.clientHeight));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [ready]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPanel(null); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, []);

  const navigate = async (target: string) => {
    try { await rendition.current?.display(target); }
    catch (e) { notify(`无法跳转：${e instanceof Error ? e.message : '位置无效'}`); }
  };
  const turn = async (direction: 'next' | 'prev') => {
    if (turning) return;
    setTurning(true);
    try { await rendition.current?.[direction](); }
    catch (e) { notify(`翻页失败：${e instanceof Error ? e.message : ''}`); }
    finally { setTurning(false); }
  };
  const addBookmark = async () => {
    const cfi = current.current?.start.cfi;
    if (!cfi || adding) return;
    setAdding(true);
    try {
      const updated = await api.saveBookmark(book.id, { cfi, chapter, title: chapter, note: '' });
      updateBook(updated);
      setSelectedBookmark(updated.bookmarks[updated.bookmarks.length - 1].id);
      setPanel('bookmarks');
      notify('书签已添加，可以为它填写独立备注');
    } catch (e) { notify(`添加失败：${e instanceof Error ? e.message : ''}`); }
    finally { setAdding(false); }
  };
  const selected = book.bookmarks.find(item => item.id === selectedBookmark);
  const togglePanel = (name: typeof panel) => setPanel(previous => previous === name ? null : name);

  return <div className="reader-shell">
    <header className="reader-toolbar"><div className="toolbar-left"><button className="text-button" onClick={back}><ArrowLeft size={18} />书库</button><span className="toolbar-divider" /><button className={`text-button ${panel === 'toc' ? 'selected' : ''}`} onClick={() => togglePanel('toc')} aria-pressed={panel === 'toc'}><List size={18} />目录</button></div><div className="reader-book-heading"><strong title={book.title}>{book.title}</strong><span>{book.author}</span></div><div className="toolbar-right"><button className={`text-button ${panel === 'bookmarks' ? 'selected' : ''}`} onClick={() => togglePanel('bookmarks')} aria-pressed={panel === 'bookmarks'}><BookmarkIcon size={18} />书签{book.bookmarks.length > 0 && <span className="count-badge">{book.bookmarks.length}</span>}</button><button className="text-button" onClick={() => togglePanel('appearance')} aria-pressed={panel === 'appearance'}><Type size={19} />外观</button></div></header>
    <div className="reader-body">
      {panel === 'toc' && <aside className="reader-panel toc-panel" aria-label="章节目录"><div className="panel-heading"><h2>目录</h2><button className="icon-button" aria-label="关闭目录" onClick={() => setPanel(null)}><X size={18} /></button></div><p className="muted fine">{chapters.length} 个章节</p><nav className="chapter-list">{chapters.map((item, index) => <button key={`${item.href}-${index}`} className={chapter === item.label.trim() ? 'active' : ''} style={{ paddingLeft: 14 + item.depth * 16 }} onClick={() => void navigate(item.href)}>{item.label.trim()}</button>)}</nav>{!chapters.length && <p className="muted">此书未提供章节目录。</p>}</aside>}
      <main className="reading-main" style={{ background: settings.background, color: settings.foreground }}>
        <div className="reading-header"><span>{ready ? chapter : '正在打开书籍'}</span><button className="icon-button add-bookmark" aria-label="在当前位置添加书签" title="在当前位置添加书签" onClick={addBookmark} disabled={!ready || adding}><BookmarkPlus size={21} /></button></div>
        <div className="reading-canvas" ref={host} data-testid="epub-content" />
        {!ready && !error && <div className="reader-loading"><LoaderCircle className="spin" size={25} /><p>正在铺开书页…</p></div>}
        {error && <div className="reader-error" role="alert"><AlertCircle size={28} /><h2>这本书暂时无法打开</h2><p>{error}</p><button className="secondary" onClick={back}>返回书库</button></div>}
        <div className="reading-bottom-note">{ready && `${chapter} · 本章 ${page.current} / ${page.total}`}</div>
      </main>
      {panel === 'bookmarks' && <aside className="reader-panel bookmarks-panel" aria-label="书签与备注"><div className="panel-heading"><h2>书签与备注</h2><button className="icon-button" aria-label="关闭书签" onClick={() => setPanel(null)}><X size={18} /></button></div><button className="secondary full-width" onClick={addBookmark} disabled={!ready || adding}><BookmarkPlus size={17} />添加当前位置</button><div className="bookmark-list">{book.bookmarks.map(item => <button key={item.id} className={`bookmark-item ${selectedBookmark === item.id ? 'active' : ''}`} onClick={() => setSelectedBookmark(item.id)}><BookmarkIcon size={15} /><div><strong>{item.title || '未命名书签'}</strong><span>{item.note || item.chapter || '暂无备注'}</span></div></button>)}</div>{!book.bookmarks.length && <div className="panel-empty"><BookmarkIcon size={30} strokeWidth={1.3} /><p>把想回来的地方留住。</p><span>每根书签都可以有自己的备注。</span></div>}{selected && <BookmarkEditor key={selected.id} disabled={adding} bookmark={selected} jump={() => void navigate(selected.cfi)} save={async input => { try { updateBook(await api.saveBookmark(book.id, input)); } catch (e) { notify(`备注保存失败：${e instanceof Error ? e.message : ''}`); throw e; } }} remove={() => { api.deleteBookmark(book.id, selected.id).then(updated => { updateBook(updated); setSelectedBookmark(null); notify('书签已删除'); }).catch(e => notify(`删除失败：${e.message}`)); }} />}</aside>}
      {panel === 'appearance' && <aside className="reader-panel" aria-label="阅读外观"><div className="panel-heading"><h2>阅读外观</h2><button className="icon-button" aria-label="关闭外观" onClick={() => setPanel(null)}><X size={18} /></button></div><Appearance settings={settings} update={updateSettings} /></aside>}
    </div>
    <footer className="reader-footer"><button className="text-button" onClick={() => void turn('prev')} disabled={!ready || turning || edges.start}><ChevronLeft size={19} />上一页</button><div className="reader-progress"><input aria-label="阅读进度" type="range" min="0" max="100" step="1" value={Math.round(progress * 100)} disabled={!locationsReady} onChange={e => { const cfi = engine.current?.locations.cfiFromPercentage(Number(e.target.value) / 100); if (cfi) void navigate(cfi); }} /><span>{locationsReady ? `已读 ${Math.round(progress * 100)}%` : ready ? '正在计算进度…' : '加载中'}</span></div><button className="text-button" onClick={() => void turn('next')} disabled={!ready || turning || edges.end}>下一页<ChevronRight size={19} /></button></footer>
  </div>;
}
