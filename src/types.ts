export type Bookmark = {
  id: string; cfi: string; chapter: string; title: string; note: string;
  createdAt: number; updatedAt: number;
};
export type BookRecord = {
  id: string; title: string; author: string; language: string; cover: string | null;
  series: string; seriesIndex: number; importedAt: number; lastReadAt: number;
  progress: number; cfi: string; bookmarks: Bookmark[];
};
export type Settings = {
  theme: 'paper' | 'white' | 'night' | 'custom';
  font: 'original' | 'serif' | 'sans' | 'kai';
  fontSize: number; lineHeight: number; background: string; foreground: string;
};
export type LibraryState = { version: number; books: BookRecord[]; settings: Settings };
export type BookmarkInput = Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };
export type LanreadAPI = {
  list(): Promise<LibraryState>;
  importBooks(): Promise<{ state: LibraryState; added: number; duplicate: number; errors: { file: string; message: string }[] }>;
  readBook(id: string): Promise<ArrayBuffer>;
  updateBook(id: string, patch: Partial<Pick<BookRecord, 'series' | 'seriesIndex' | 'cfi' | 'progress'>>): Promise<BookRecord>;
  deleteBook(id: string): Promise<LibraryState>;
  saveSettings(settings: Partial<Settings>): Promise<Settings>;
  saveBookmark(id: string, bookmark: BookmarkInput): Promise<BookRecord>;
  deleteBookmark(id: string, bookmarkId: string): Promise<BookRecord>;
  dataPath(): Promise<string>;
};
declare global { interface Window { lanread?: LanreadAPI } }
