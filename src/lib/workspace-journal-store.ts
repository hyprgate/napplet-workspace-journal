import { storage } from '@napplet/sdk';
import {
  parseWorkspaceJournalCapturePayload,
  type WorkspaceJournalCapturePayload,
} from '@hyprgate/utils';

export interface JournalEntry {
  id: string;
  title: string;
  body: string;
  refs: string[];
  createdAt: number;
  updatedAt: number;
}

export interface JournalState {
  entries: JournalEntry[];
  query: string;
  selectedId: string | null;
}

export const WORKSPACE_JOURNAL_KEY = 'workspace-journal:v1';

export function createInitialJournalState(): JournalState {
  return {
    entries: [],
    query: '',
    selectedId: null,
  };
}

export function parseRefs(input: string): string[] {
  const matches = input.match(/\b(?:n(?:ote|pub|profile|addr)1[023456789acdefghjklmnpqrstuvwxyz]+|wss:\/\/[^\s,;]+)\b/gi) ?? [];
  return Array.from(new Set(matches.map((ref) => ref.trim())));
}

function normalizeEntries(entries: JournalEntry[]): JournalEntry[] {
  return entries
    .filter((entry) => entry.id && entry.title)
    .map((entry) => ({ ...entry, refs: Array.isArray(entry.refs) ? entry.refs : [] }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function searchJournalEntries(state: JournalState): JournalEntry[] {
  const q = state.query.trim().toLowerCase();
  if (!q) return normalizeEntries(state.entries);
  return normalizeEntries(state.entries).filter((entry) => {
    const haystack = [entry.title, entry.body, ...entry.refs].join(' ').toLowerCase();
    return haystack.includes(q);
  });
}

export function selectedJournalEntry(state: JournalState): JournalEntry | null {
  return state.entries.find((entry) => entry.id === state.selectedId) ?? searchJournalEntries(state)[0] ?? null;
}

export function createJournalEntry(state: JournalState, input: { title: string; body: string; refsText?: string }, now = Date.now()): JournalState {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) return state;
  const refs = Array.from(new Set([...parseRefs(body), ...parseRefs(input.refsText ?? '')]));
  const entry: JournalEntry = {
    id: `entry-${now}`,
    title,
    body,
    refs,
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...state,
    entries: [entry, ...state.entries],
    selectedId: entry.id,
  };
}

export function captureJournalEntry(state: JournalState, payload: WorkspaceJournalCapturePayload, now = Date.now()): JournalState {
  const parsed = parseWorkspaceJournalCapturePayload(payload);
  if (!parsed) return state;
  const refs = Array.from(new Set([...parseRefs(parsed.body), ...(parsed.refs ?? [])]));
  const entry: JournalEntry = {
    id: `entry-${now}`,
    title: parsed.title,
    body: parsed.body,
    refs,
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...state,
    entries: normalizeEntries([entry, ...state.entries]),
    selectedId: entry.id,
  };
}

export async function restoreJournalState(): Promise<JournalState> {
  const fallback = createInitialJournalState();
  try {
    const raw = await storage.getItem(WORKSPACE_JOURNAL_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<JournalState>;
    const entries = Array.isArray(parsed.entries)
      ? normalizeEntries(parsed.entries as JournalEntry[])
      : fallback.entries;
    return {
      entries,
      query: typeof parsed.query === 'string' ? parsed.query : '',
      selectedId: typeof parsed.selectedId === 'string' ? parsed.selectedId : entries[0]?.id ?? null,
    };
  } catch {
    return fallback;
  }
}

export function persistJournalState(state: JournalState): void {
  void storage.setItem(WORKSPACE_JOURNAL_KEY, JSON.stringify(state)).catch(() => {
    // Storage is best-effort; the UI keeps the in-memory state.
  });
}
