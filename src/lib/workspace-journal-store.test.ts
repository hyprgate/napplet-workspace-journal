import { describe, expect, it, vi, beforeEach } from 'vitest';
import { storage } from '@napplet/sdk';
import {
  WORKSPACE_JOURNAL_KEY,
  captureJournalEntry,
  createInitialJournalState,
  createJournalEntry,
  parseRefs,
  persistJournalState,
  restoreJournalState,
  searchJournalEntries,
  selectedJournalEntry,
} from './workspace-journal-store';

vi.mock('@napplet/sdk', () => ({
  storage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(storage.getItem).mockReset();
  vi.mocked(storage.setItem).mockReset();
});

describe('workspace journal store', () => {
  it('starts empty instead of loading sample notes', () => {
    expect(createInitialJournalState().entries).toEqual([]);
  });

  it('parses explicit Nostr and relay references', () => {
    expect(parseRefs('review note1qqsample and wss://relay.example/path')).toEqual([
      'note1qqsample',
      'wss://relay.example/path',
    ]);
  });

  it('creates entries with references from body and refs text', () => {
    const next = createJournalEntry(createInitialJournalState(), {
      title: 'Follow up',
      body: 'Open npub1samplepers0n',
      refsText: 'wss://relay.example',
    }, 42);

    expect(next.entries[0]!.title).toBe('Follow up');
    expect(next.entries[0]!.refs).toEqual(['npub1samplepers0n', 'wss://relay.example']);
    expect(selectedJournalEntry(next)?.id).toBe('entry-42');
  });

  it('captures journal entries from NUB-06 payloads', () => {
    const next = captureJournalEntry(createInitialJournalState(), {
      title: 'Captured',
      body: 'See note1captured',
      refs: ['wss://relay.example'],
    }, 7);

    expect(next.entries[0]!.refs).toEqual(['note1captured', 'wss://relay.example']);
    expect(next.selectedId).toBe('entry-7');
  });

  it('searches title, body, and references', () => {
    const state = {
      ...captureJournalEntry(createInitialJournalState(), { title: 'Relay', body: 'wss://relay.example' }, 1),
      query: 'relay.example',
    };

    expect(searchJournalEntries(state)).toHaveLength(1);
  });

  it('restores stored journal state through shell-mediated storage', async () => {
    vi.mocked(storage.getItem).mockResolvedValue(JSON.stringify({
      entries: [{ id: 'stored', title: 'Stored', body: 'Body', refs: [], createdAt: 1, updatedAt: 1 }],
      query: 'stored',
      selectedId: 'stored',
    }));

    const restored = await restoreJournalState();

    expect(storage.getItem).toHaveBeenCalledWith(WORKSPACE_JOURNAL_KEY);
    expect(restored.entries[0]!.title).toBe('Stored');
    expect(restored.query).toBe('stored');
  });

  it('persists through shell-mediated storage', () => {
    const state = createInitialJournalState();
    vi.mocked(storage.setItem).mockResolvedValue(undefined);

    persistJournalState(state);

    expect(storage.setItem).toHaveBeenCalledWith(WORKSPACE_JOURNAL_KEY, JSON.stringify(state));
  });
});
