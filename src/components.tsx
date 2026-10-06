import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { BookRecord, Settings } from './types';

export function Cover({ book, small = false }: { book: BookRecord; small?: boolean }) {
  if (book.cover) return <img className={`cover ${small ? 'small' : ''}`} src={book.cover} alt={`${book.title}封面`} draggable={false} />;
  return <div className={`cover generated ${small ? 'small' : ''}`} style={{ '--cover-hue': `${190 + parseInt(book.id.slice(0, 2), 16) % 35}` } as React.CSSProperties}>
    <span className="cover-mark">LANREAD · 岚读</span>
    <span className="cover-title">{book.title}</span>
    <span className="cover-author">{book.author}</span>
    <span className="cover-line" />
  </div>;
}

export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, button, textarea, select')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const elements = Array.from(ref.current?.querySelectorAll<HTMLElement>('button, input, textarea, select, [tabindex="0"]') ?? []);
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div ref={ref} className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="panel-heading"><h2>{title}</h2><button className="icon-button" aria-label="关闭弹窗" onClick={close}><X size={19} /></button></div>
      {children}
    </div>
  </div>;
}

export const palettes = {
  paper: { background: '#f5f9fc', foreground: '#263746', name: '冰蓝' },
  white: { background: '#ffffff', foreground: '#2c3540', name: '纯白' },
  night: { background: '#192633', foreground: '#d5e2ed', name: '夜读' },
};

export function Appearance({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  return <div className="appearance">
    <p className="muted">设置会自动保存，并应用于所有书籍。</p>
    <label className="field">正文字体
      <select value={settings.font} onChange={e => update({ font: e.target.value as Settings['font'] })}>
        <option value="original">书籍原字体</option><option value="serif">宋体 · 衬线</option>
        <option value="sans">微软雅黑 · 无衬线</option><option value="kai">楷体</option>
      </select>
    </label>
    <label className="field"><span className="label-row">字号 <b>{settings.fontSize} px</b></span>
      <input aria-label="字号" type="range" min="14" max="36" step="1" value={settings.fontSize} onChange={e => update({ fontSize: Number(e.target.value) })} />
    </label>
    <label className="field"><span className="label-row">行距 <b>{settings.lineHeight.toFixed(1)}</b></span>
      <input aria-label="行距" type="range" min="1.3" max="2.4" step="0.1" value={settings.lineHeight} onChange={e => update({ lineHeight: Number(e.target.value) })} />
    </label>
    <div className="field">阅读配色
      <div className="palette-row">{Object.entries(palettes).map(([key, palette]) => <button key={key} aria-label={`${palette.name}配色`} className={`palette ${settings.theme === key ? 'selected' : ''}`} style={{ background: palette.background, color: palette.foreground }} onClick={() => update({ theme: key as Settings['theme'], background: palette.background, foreground: palette.foreground })} aria-pressed={settings.theme === key}>Aa<span>{palette.name}</span></button>)}</div>
    </div>
    <div className="color-fields">
      <label className="field">背景颜色<input aria-label="背景颜色" type="color" value={settings.background} onChange={e => update({ theme: 'custom', background: e.target.value })} /></label>
      <label className="field">文字颜色<input aria-label="文字颜色" type="color" value={settings.foreground} onChange={e => update({ theme: 'custom', foreground: e.target.value })} /></label>
    </div>
    <div className="text-preview" style={{ background: settings.background, color: settings.foreground, fontSize: settings.fontSize, lineHeight: settings.lineHeight }}>风从书页间经过，<br />故事在这里继续。</div>
    <p className="muted fine">字体使用本机已安装字体；缺失时自动使用同类字体。</p>
  </div>;
}
