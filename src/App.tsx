import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { BookOpen, LibraryBig, Layers3, Clock3, Bookmark, Plus, Search, ChevronLeft, ChevronRight, MoreHorizontal, Settings2, X, FolderOpen, Check, Trash2, LoaderCircle } from 'lucide-react';
import { inferredIndex, sortSeriesBooks } from './series';
import { Cover, Modal, Appearance } from './components';
import type { BookRecord, LibraryState, Settings } from './types';

const Reader = lazy(() => import('./Reader').then(module => ({ default: module.Reader })));

type View = 'all' | 'recent' | 'series' | 'bookmarks';
type Group = { key: string; series: string; books: BookRecord[] };

export function App() {
  const api = window.lanread;
  const [state, setState] = useState<LibraryState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<View>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [series, setSeries] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [importErrors, setImportErrors] = useState<{ file: string; message: string }[] | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [edit, setEdit] = useState<BookRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BookRecord | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [newSeries, setNewSeries] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [savingSeries, setSavingSeries] = useState(false);
  const [dataPath, setDataPath] = useState('');

  useEffect(() => {
    if (!api) { setLoadError('请使用桌面应用打开岚读。开发模式运行 npm run dev，构建后运行 npm start。'); return; }
    api.list().then(setState).catch(error => setLoadError(error.message));
    api.dataPath().then(setDataPath).catch(() => {});
  }, [api]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 6500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!menuId) return;
    const close = () => setMenuId(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuId]);

  const updateBook = (book: BookRecord) => setState(previous => previous && ({ ...previous, books: previous.books.map(b => b.id === book.id ? book : b) }));
  const notifyError = (error: unknown) => setToast(error instanceof Error ? error.message : '操作失败，请重试。');
  const updateSettings = (patch: Partial<Settings>) => {
    setState(previous => previous && ({ ...previous, settings: { ...previous.settings, ...patch } }));
    api?.saveSettings(patch).catch(notifyError);
  };
  const importBooks = async () => {
    if (!api || busy) return;
    setBusy(true);
    try {
      const result = await api.importBooks();
      setState(result.state);
      if (result.added || result.duplicate) setToast(`已导入 ${result.added} 本${result.duplicate ? `，跳过 ${result.duplicate} 本重复书籍` : ''}`);
      if (result.errors.length) setImportErrors(result.errors);
    } catch (error) { notifyError(error); }
    finally { setBusy(false); }
  };

  const books = state?.books ?? [];
  const seriesRecords = state?.series ?? [];
  const currentSeries = seriesRecords.find(item => item.name === series);
  const seriesBooks = sortSeriesBooks(books.filter(book => book.series === series), currentSeries);
  const groups = useMemo(() => {
    const selected = books.filter(book => {
      const matches = `${book.title} ${book.author} ${book.series}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim());
      return matches && (!series || book.series === series) &&
        (view !== 'recent' || book.lastReadAt > 0) && (view !== 'series' || Boolean(book.series)) && (view !== 'bookmarks' || book.bookmarks.length > 0);
    });
    const map = new Map<string, Group>();
    for (const book of selected) {
      const key = !series && book.series ? `series:${book.series}` : `book:${book.id}`;
      const group = map.get(key) ?? { key, series: !series ? book.series : '', books: [] };
      group.books.push(book);
      map.set(key, group);
    }
    if (!series && (view === 'all' || view === 'series')) for (const item of seriesRecords) {
      if (!books.some(book => book.series === item.name) && item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim())) {
        map.set(`series:${item.name}`, { key: `series:${item.name}`, series: item.name, books: [] });
      }
    }
    const groups = [...map.values()];
    groups.forEach(group => { group.books = sortSeriesBooks(group.books, seriesRecords.find(item => item.name === group.series)); });
    if (series) {
      const order = sortSeriesBooks(selected, currentSeries).map(book => book.id);
      return groups.sort((a, b) => order.indexOf(a.books[0].id) - order.indexOf(b.books[0].id));
    }
    return groups.sort((a, b) => sort === 'title'
      ? (a.series || a.books[0]?.title || '').localeCompare(b.series || b.books[0]?.title || '', 'zh-CN')
      : Math.max(0, ...b.books.map(book => sort === 'added' ? book.importedAt : book.lastReadAt || book.importedAt)) - Math.max(0, ...a.books.map(book => sort === 'added' ? book.importedAt : book.lastReadAt || book.importedAt)));
  }, [books, query, sort, series, view, seriesRecords, currentSeries]);

  const toastNode = toast && <div className="toast" role="status"><Check size={17} /><span>{toast}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setToast('')}><X size={16} /></button></div>;
  if (loadError) return <div className="launch-error"><BookOpen size={44} /><h1>岚读</h1><p>{loadError}</p></div>;
  if (!state || !api) return <div className="launch-error"><LoaderCircle className="spin" size={28} /><p>正在打开书库…</p></div>;
  const activeBook = books.find(book => book.id === activeId);
  if (activeBook) return <><Suspense fallback={<div className="launch-error"><LoaderCircle className="spin" size={28} /><p>正在打开阅读器…</p></div>}><Reader book={activeBook} settings={state.settings} api={api} updateBook={updateBook} updateSettings={updateSettings} back={() => setActiveId(null)} notify={setToast} /></Suspense>{toastNode}</>;

  const navigate = (next: View) => { setView(next); setSeries(null); setQuery(''); };
  const views = [
    { id: 'all' as const, name: '全部书籍', icon: LibraryBig, count: books.length },
    { id: 'recent' as const, name: '最近阅读', icon: Clock3, count: books.filter(b => b.lastReadAt).length },
    { id: 'series' as const, name: '系列书架', icon: Layers3, count: seriesRecords.length },
    { id: 'bookmarks' as const, name: '有书签的书', icon: Bookmark, count: books.filter(b => b.bookmarks.length).length },
  ];
  const dropBook = async (target: string, targetId?: string, after = false) => {
    const id = dragId;
    setDragId(null); setDropKey(null);
    if (!id || savingSeries) return;
    setSavingSeries(true);
    try {
      if (targetId && currentSeries?.mode === 'manual') {
        const order = seriesBooks.map(book => book.id).filter(bookId => bookId !== id);
        order.splice(order.indexOf(targetId) + (after ? 1 : 0), 0, id);
        setState(await api.saveSeries(target, 'manual', order));
        setToast('顺序已保存');
      } else {
        await api.updateBook(id, { series: target });
        setState(await api.list());
        setToast(`已加入系列「${target}」`);
      }
    } catch (error) { notifyError(error); }
    finally { setSavingSeries(false); }
  };
  const changeSeriesMode = async (mode: 'auto' | 'manual') => {
    if (!series || savingSeries) return;
    setSavingSeries(true);
    try { setState(await api.saveSeries(series, mode, seriesBooks.map(book => book.id))); }
    catch (error) { notifyError(error); }
    finally { setSavingSeries(false); }
  };
  const heading = series || views.find(item => item.id === view)!.name;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><BookOpen size={26} strokeWidth={1.7} /></div><div><strong>岚读</strong><span>LANREAD</span></div></div>
      <p className="nav-caption">我的书库</p>
      <nav aria-label="书库导航">{views.map(item => <button key={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)}><item.icon size={19} /><span>{item.name}</span><small>{item.count}</small></button>)}</nav>
      <div className="sidebar-bottom"><div className="offline-label"><span />离线阅读 · 本地保存</div><button className="nav-item" onClick={() => setShowSettings(true)}><Settings2 size={19} /><span>阅读设置</span></button><p className="version">岚读 0.2.0</p></div>
    </aside>
    <main className="library-main">
      <header className="library-topbar"><div className="search-box"><Search size={18} /><input aria-label="搜索书库" placeholder="搜索书名、作者或系列" value={query} onChange={e => setQuery(e.target.value)} />{query && <button className="icon-button" aria-label="清除搜索" onClick={() => setQuery('')}><X size={15} /></button>}</div><button className="primary" onClick={importBooks} disabled={busy}>{busy ? <LoaderCircle size={18} className="spin" /> : <Plus size={18} />}{busy ? '导入中…' : '导入书籍'}</button></header>
      <section className="library-content">
        <div className="library-heading"><div>{series && <button className="breadcrumb" onClick={() => setSeries(null)}><ChevronLeft size={15} />返回书架</button>}<p className="eyebrow">YOUR READING SPACE</p><h1>{heading}</h1><p className="muted">{series ? currentSeries?.mode === 'manual' ? '拖动书籍调整顺序；也可以用箭头移动。' : '优先按册序，再识别书名与文件名编号。' : books.length ? '翻开一本书，给自己一段安静的时间。' : '你的下一段故事，从这里开始。'}</p></div><div className="library-actions">{!series && <button className="secondary" onClick={() => setNewSeries('')}><Plus size={16} />新建系列</button>}{series ? <label className="sort-control">系列排序<select aria-label="系列排序" disabled={savingSeries} value={currentSeries?.mode ?? 'auto'} onChange={e => changeSeriesMode(e.target.value as 'auto' | 'manual')}><option value="auto">自动册序</option><option value="manual">手动拖拽</option></select></label> : <label className="sort-control">排序<select aria-label="书库排序" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">最近阅读</option><option value="added">最近导入</option><option value="title">名称</option></select></label>}</div></div>
        {!groups.length ? <div className="empty-state"><div className="empty-illustration"><BookOpen size={62} strokeWidth={1} /><span className="empty-spark">+</span></div><h2>{books.length ? '这里还没有书籍' : '给书架添上第一本书'}</h2><p>{query ? '换个关键词，试试书名、作者或系列。' : view === 'recent' ? '打开一本书，阅读进度会自动记录。' : view === 'series' ? '新建系列，再将单本书拖到系列卡片上。' : view === 'bookmarks' ? '在阅读页面添加书签，也可以给每根书签写备注。' : '导入 EPUB，封面与作者会自动整理。'}</p>{view === 'all' && !query && <button className="primary" onClick={importBooks} disabled={busy}><Plus size={18} />选择 EPUB 文件</button>}<span className="empty-hint">支持 EPUB 2 / 3 · 无需联网</span></div>
          : <div className="book-grid">{groups.map(group => {
            const book = group.books[0];
            const canReorder = Boolean(series && currentSeries?.mode === 'manual' && !query && !savingSeries);
            const stacked = Boolean(group.series);
            return <article className={`book-card ${stacked ? 'series-card' : ''} ${dropKey === group.key ? 'drop-target' : ''} ${dragId === book?.id ? 'dragging' : ''}`} key={group.key}
              data-book-id={stacked ? undefined : book?.id} data-series={group.series || undefined}
              draggable={!stacked && !savingSeries && (!series || canReorder)}
              onDragStart={e => { if (stacked || savingSeries || series && !canReorder) { e.preventDefault(); return; } setDragId(book.id); e.dataTransfer.setData('text/plain', book.id); e.dataTransfer.effectAllowed = 'move'; }}
              onDragEnd={() => { setDragId(null); setDropKey(null); }}
              onDragOver={e => { if (dragId && (stacked || canReorder && book.id !== dragId)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropKey(group.key); } }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropKey(null); }}
              onDrop={e => { e.preventDefault(); if (dragId && (stacked || canReorder && book.id !== dragId)) { const rect = e.currentTarget.getBoundingClientRect(); dropBook(group.series || series!, stacked ? undefined : book.id, e.clientX > rect.left + rect.width / 2); } }}>
              {book ? <>
              <button className="book-open" aria-label={stacked ? `展开系列 ${group.series}` : `阅读 ${book.title}`} onClick={() => { if (stacked) { setSeries(group.series); setView('all'); setQuery(''); } else setActiveId(book.id); }}>
                <div className={`cover-wrapper ${stacked ? 'stack' : ''}`}>{stacked && <><div className="stack-layer back" /><div className="stack-layer middle" /></>}<Cover book={book} />{stacked && <span className="series-badge"><Layers3 size={13} />{group.books.length} 本</span>}</div>
                <div className="book-description"><h3 title={stacked ? group.series : book.title}>{stacked ? group.series : book.title}</h3><p title={book.author}>{stacked ? [...new Set(group.books.map(b => b.author))].join('、') : book.author}</p>{stacked ? <span className="series-link">展开系列 <ChevronRight size={13} /></span> : <div className="book-progress"><div className="progress-track"><span style={{ width: `${book.progress * 100}%` }} /></div><small>{book.cfi ? `已读 ${Math.round(book.progress * 100)}%` : '未开始'}</small></div>}</div>
              </button>
              {!stacked && <span className="volume-label">{series && (inferredIndex(book) !== null ? `册序 ${inferredIndex(book)}` : '未识别册序')}</span>}
              {canReorder && <div className="reorder-controls"><button className="icon-button" aria-label={`前移 ${book.title}`} disabled={seriesBooks[0].id === book.id} onClick={() => { setDragId(book.id); const order = seriesBooks.map(b => b.id); const index = order.indexOf(book.id); [order[index - 1], order[index]] = [order[index], order[index - 1]]; setDragId(null); setSavingSeries(true); api.saveSeries(series!, 'manual', order).then(setState).catch(notifyError).finally(() => setSavingSeries(false)); }}><ChevronLeft size={16} /></button><span>拖拽排序</span><button className="icon-button" aria-label={`后移 ${book.title}`} disabled={seriesBooks.at(-1)?.id === book.id} onClick={() => { const order = seriesBooks.map(b => b.id); const index = order.indexOf(book.id); [order[index + 1], order[index]] = [order[index], order[index + 1]]; setSavingSeries(true); api.saveSeries(series!, 'manual', order).then(setState).catch(notifyError).finally(() => setSavingSeries(false)); }}><ChevronRight size={16} /></button></div>}
              {!stacked && <div className="book-menu-wrap"><button className="icon-button book-menu-button" aria-label={`${book.title}的菜单`} onClick={e => { e.stopPropagation(); setMenuId(menuId === book.id ? null : book.id); }}><MoreHorizontal size={19} /></button>{menuId === book.id && <div className="book-menu"><button onClick={() => setEdit({ ...book })}><Layers3 size={15} />编辑系列</button><button className="danger-text" onClick={() => setDeleteTarget(book)}><Trash2 size={15} />移出书库</button></div>}</div>}
              </> : <button className="empty-series-card" aria-label={`展开系列 ${group.series}`} onClick={() => { setSeries(group.series); setView('all'); setQuery(''); }}><Layers3 size={40} strokeWidth={1.2} /><h3>{group.series}</h3><p>拖入书籍，开始收藏</p></button>}
              {stacked && dragId && <div className="drop-hint">放开以加入系列</div>}
            </article>;
          })}</div>}
        <footer className="library-footer"><span>{books.length} 本书 · {seriesRecords.length} 个系列</span><span>书页之间，自有天地</span></footer>
      </section>
    </main>
    {newSeries !== null && <Modal title="新建系列" close={() => setNewSeries(null)}><form onSubmit={async e => { e.preventDefault(); if (savingSeries) return; setSavingSeries(true); try { setState(await api.createSeries(newSeries)); setNewSeries(null); setToast('系列已创建，将单本书拖到系列卡片即可加入'); } catch (error) { notifyError(error); } finally { setSavingSeries(false); } }}><label className="field">系列名称<input autoFocus aria-label="新系列名称" maxLength={200} required value={newSeries} onChange={e => setNewSeries(e.target.value)} /></label><p className="muted">先建一个书架，再把书拖进去。同名系列会合并。</p><div className="modal-actions"><button type="button" className="secondary" onClick={() => setNewSeries(null)}>取消</button><button className="primary" disabled={savingSeries || !newSeries.trim()} type="submit">创建系列</button></div></form></Modal>}
    {series && query && currentSeries?.mode === 'manual' && <div className="toast" role="status">清除搜索后即可拖拽排序，避免移动隐藏的书籍。</div>}
    {edit && <Modal title="编辑系列" close={() => setEdit(null)}><p className="muted">{edit.title} · {edit.author}</p><form onSubmit={async e => { e.preventDefault(); try { await api.updateBook(edit.id, { series: edit.series, seriesIndex: edit.seriesIndex }); setState(await api.list()); setEdit(null); setToast('系列已保存'); } catch (error) { notifyError(error); } }}><label className="field">系列名称<input aria-label="系列名称" maxLength={200} list="series-names" placeholder="留空表示单本书" value={edit.series} onChange={e => setEdit({ ...edit, series: e.target.value })} /><datalist id="series-names">{seriesRecords.map(item => <option value={item.name} key={item.name} />)}</datalist></label><label className="field">系列内册序<input aria-label="系列内册序" type="number" min="0" max="99999" step="0.1" value={edit.seriesIndex} onChange={e => setEdit({ ...edit, seriesIndex: Number(e.target.value) })} /></label><p className="muted fine">相同系列名称会自动堆叠；0 表示自动识别，支持 1.5 等番外册序。手动排序模式优先使用拖拽顺序。</p><div className="modal-actions"><button type="button" className="secondary" onClick={() => setEdit(null)}>取消</button><button className="primary" type="submit">保存系列</button></div></form></Modal>}
    {deleteTarget && <Modal title="移出书库？" close={() => setDeleteTarget(null)}><p>将移除《{deleteTarget.title}》及它的阅读进度、书签和备注。</p><p className="muted">你导入前的原始 EPUB 文件不会被删除。</p><div className="modal-actions"><button className="secondary" onClick={() => setDeleteTarget(null)}>取消</button><button className="danger" onClick={async () => { try { setState(await api.deleteBook(deleteTarget.id)); setDeleteTarget(null); setToast('已移出书库'); } catch (error) { notifyError(error); } }}>确认移除</button></div></Modal>}
    {importErrors && <Modal title="部分书籍未能导入" close={() => setImportErrors(null)}><div className="import-errors">{importErrors.map((error, index) => <div key={index}><strong>{error.file}</strong><p>{error.message}</p></div>)}</div><p className="muted">其他有效书籍已正常导入。</p><button className="primary" onClick={() => setImportErrors(null)}>知道了</button></Modal>}
    {showSettings && <Modal title="阅读设置" close={() => setShowSettings(false)}><Appearance settings={state.settings} update={updateSettings} /><div className="storage-info"><FolderOpen size={16} /><div><strong>本地数据目录</strong><code>{dataPath}</code><p>备份整个目录即可保留书籍、书签和备注。</p></div></div></Modal>}
    {toastNode}
  </div>;
}
