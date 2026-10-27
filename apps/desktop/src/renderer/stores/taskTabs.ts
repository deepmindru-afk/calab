import { create } from 'zustand';
import { persist, type StateStorage } from 'zustand/middleware';

/**
 * Open tasks as browser-like tabs (#93, desktop web client only). A tab remembers where its task
 * lives (workspace, board) and a snapshot of key + title, so the strip is complete after F5 before
 * any task is loaded. The active tab is not stored: it is the open task (useBoardsUi.taskId).
 * Kept per browser in localStorage (every access guarded: it may throw or be absent); no sync.
 */
export interface TaskTab {
  id: string;
  ws: string;
  board: string;
  key: string;
  title: string;
  /** When it was last the open task (ms): the oldest one is dropped past {@link MAX_TABS}. */
  at: number;
}

export interface TabsState {
  tabs: TaskTab[];
  /** The tab a plain open replaces (the last one that was open); null = none yet. */
  cur: string | null;
}

export const MAX_TABS = 10;

/** Makes room for one more: drops the least recently used tab that is not `keep`. */
function fit(tabs: TaskTab[], keep: string): TaskTab[] {
  const out = [...tabs];
  while (out.length > MAX_TABS) {
    let oldest = -1;
    out.forEach((tb, i) => {
      if (tb.id !== keep && (oldest < 0 || tb.at < (out[oldest]?.at ?? Infinity))) oldest = i;
    });
    if (oldest < 0) break;
    out.splice(oldest, 1);
  }
  return out;
}

/**
 * A task became the open one (a plain open): an existing tab just becomes current; otherwise it
 * replaces the current tab in place (browser: the current tab navigates) or, with no current tab,
 * is appended. With no tabs at all nothing is created — a single task needs no strip.
 */
export function reduceActivate(s: TabsState, entry: TaskTab): TabsState {
  const have = s.tabs.findIndex((x) => x.id === entry.id);
  if (have >= 0) return { tabs: s.tabs.map((x, i) => (i === have ? { ...x, at: entry.at } : x)), cur: entry.id };
  if (s.tabs.length === 0) return s.cur === null ? s : { tabs: s.tabs, cur: null };
  const at = s.cur ? s.tabs.findIndex((x) => x.id === s.cur) : -1;
  if (at >= 0) return { tabs: s.tabs.map((x, i) => (i === at ? entry : x)), cur: entry.id };
  return { tabs: fit([...s.tabs, entry], entry.id), cur: entry.id };
}

/**
 * «Открыть в новой вкладке»: appended in the background (the open task stays open). The task that
 * is open right now (`open`) joins the strip first when it is not there yet, so it is not lost.
 */
export function reduceAdd(s: TabsState, entry: TaskTab, open?: TaskTab): TabsState {
  let tabs = s.tabs;
  if (open && !tabs.some((x) => x.id === open.id)) tabs = [...tabs, open];
  if (!tabs.some((x) => x.id === entry.id)) tabs = [...tabs, entry];
  return { tabs: fit(tabs, open?.id ?? entry.id), cur: s.cur };
}

/** Closes a tab; `next` is the tab to show instead when it was the open one (right neighbour first). */
export function reduceClose(s: TabsState, id: string): { state: TabsState; next: TaskTab | null } {
  const i = s.tabs.findIndex((x) => x.id === id);
  if (i < 0) return { state: s, next: null };
  const tabs = s.tabs.filter((x) => x.id !== id);
  return { state: { tabs, cur: s.cur === id ? null : s.cur }, next: tabs[i] ?? tabs[i - 1] ?? null };
}

/** Refreshes the snapshot of key + title; the same object when nothing changed. */
export function reduceSync(s: TabsState, id: string, key: string, title: string): TabsState {
  const tb = s.tabs.find((x) => x.id === id);
  if (!tb || (tb.key === key && tb.title === title)) return s;
  return { ...s, tabs: s.tabs.map((x) => (x.id === id ? { ...x, key, title } : x)) };
}

/** A stored value from another build must not break the strip. */
export function sanitizeTabs(raw: unknown): TabsState {
  const o = (raw && typeof raw === 'object' ? raw : {}) as { tabs?: unknown; cur?: unknown };
  const list = Array.isArray(o.tabs) ? o.tabs : [];
  const tabs: TaskTab[] = [];
  for (const x of list) {
    const v = (x ?? {}) as Partial<TaskTab>;
    if (typeof v.id !== 'string' || !v.id || typeof v.ws !== 'string' || typeof v.board !== 'string') continue;
    if (tabs.some((y) => y.id === v.id)) continue;
    tabs.push({ id: v.id, ws: v.ws, board: v.board, key: typeof v.key === 'string' ? v.key : '', title: typeof v.title === 'string' ? v.title : '', at: typeof v.at === 'number' ? v.at : 0 });
  }
  const cur = typeof o.cur === 'string' && tabs.some((x) => x.id === o.cur) ? o.cur : null;
  return { tabs: fit(tabs, ''), cur };
}

const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      /* quota / blocked storage: the tabs just stay in memory */
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      /* nothing to remove */
    }
  },
};

interface TabsStore extends TabsState {
  /** The boards section is on screen (BoardsView mounted); not persisted. */
  shown: boolean;
  setShown: (on: boolean) => void;
  activate: (entry: TaskTab) => void;
  add: (entry: TaskTab, open?: TaskTab) => void;
  close: (id: string) => TaskTab | null;
  sync: (id: string, key: string, title: string) => void;
}

export const useTaskTabs = create<TabsStore>()(
  persist(
    (set, get) => ({
      tabs: [],
      cur: null,
      shown: false,
      setShown: (shown) => set({ shown }),
      activate: (entry) => set((s) => reduceActivate(s, entry)),
      add: (entry, open) => set((s) => reduceAdd(s, entry, open)),
      close: (id) => {
        const r = reduceClose(get(), id);
        set(r.state);
        return r.next;
      },
      sync: (id, key, title) => set((s) => reduceSync(s, id, key, title)),
    }),
    {
      name: 'calaba-task-tabs',
      version: 1,
      storage: {
        getItem: (name) => {
          const raw = safeStorage.getItem(name) as string | null;
          if (!raw) return null;
          try {
            return JSON.parse(raw) as { state: TabsState };
          } catch {
            return null;
          }
        },
        setItem: (name, value) => safeStorage.setItem(name, JSON.stringify(value)),
        removeItem: (name) => safeStorage.removeItem(name),
      },
      partialize: (s) => ({ tabs: s.tabs, cur: s.cur }),
      merge: (stored, cur) => ({ ...cur, ...sanitizeTabs(stored) }),
    },
  ),
);
