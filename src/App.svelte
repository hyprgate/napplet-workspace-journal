<script lang="ts">
  import { onMount } from 'svelte';
  import { inc as ipc, intent } from '@napplet/sdk';
  import { createIntentRequest, parseIntentResult, type IntentRequest } from '@hyprgate/types';
  import {
    invokeNappletIntent,
    WORKSPACE_JOURNAL_CAPTURE_TOPIC,
    createNoteViewerOpenIntentRequest,
    createNoteViewerOpenPayload,
    createProfileIntentRequest,
    parseWorkspaceJournalCapturePayload,
  } from '@hyprgate/utils';
  import {
    captureJournalEntry,
    createJournalEntry,
    persistJournalState,
    restoreJournalState,
    searchJournalEntries,
    selectedJournalEntry,
    type JournalEntry,
    type JournalState,
  } from './lib/workspace-journal-store';

  let state = $state<JournalState>({ entries: [], query: '', selectedId: null });
  let title = $state('');
  let body = $state('');
  let refsText = $state('');
  const results = $derived(searchJournalEntries(state));
  const selected = $derived(selectedJournalEntry(state));

  onMount(() => {
    restoreJournalState().then((restored) => {
      state = restored;
    });
    const sub = ipc.on(WORKSPACE_JOURNAL_CAPTURE_TOPIC, (event) => {
      const capture = parseWorkspaceJournalCapturePayload(event.payload);
      if (!capture) return;
      state = captureJournalEntry(state, capture);
      persistJournalState(state);
    });
    return () => sub.close();
  });

  function selectEntry(entry: JournalEntry): void {
    state = { ...state, selectedId: entry.id };
    persistJournalState(state);
  }

  function setQuery(value: string): void {
    state = { ...state, query: value };
    persistJournalState(state);
  }

  function saveEntry(): void {
    state = createJournalEntry(state, { title, body, refsText });
    title = '';
    body = '';
    refsText = '';
    persistJournalState(state);
  }

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  async function invokeNavigation(request: IntentRequest | null): Promise<void> {
    if (!request) return;
    try {
      const result = parseIntentResult(await invokeNappletIntent(request));
      if (!result || result.archetype !== request.archetype || result.action !== (request.action ?? 'open')) return;
      if (!result.ok) return;
    } catch {
      // Keep the existing no-op behavior when navigation is unavailable.
    }
  }

  async function openRef(ref: string): Promise<void> {
    if (ref.startsWith('wss://')) {
      await invokeNavigation(createIntentRequest({
        archetype: 'relay-browser',
        action: 'inspect',
        payload: { relay: ref },
      }));
      return;
    }
    if (ref.startsWith('npub') || ref.startsWith('nprofile')) {
      await invokeNavigation(createProfileIntentRequest({ pubkey: ref }));
      return;
    }
    const payload = createNoteViewerOpenPayload({
      target: { type: 'event', id: ref },
      source: { napplet: 'workspace-journal' },
      behavior: { focus: true, reuse: false },
    });
    await invokeNavigation(payload ? createNoteViewerOpenIntentRequest(payload, { behavior: payload.behavior }) : null);
  }
</script>

<main class="journal-shell">
  <header class="toolbar">
    <input
      aria-label="Search journal"
      placeholder="search..."
      value={state.query}
      oninput={(event) => setQuery(event.currentTarget.value)}
    />
  </header>

  <section class="content">
    <form class="editor" onsubmit={(event) => { event.preventDefault(); saveEntry(); }}>
      <input aria-label="Entry title" placeholder="title" bind:value={title} />
      <textarea aria-label="Entry body" placeholder="note" bind:value={body}></textarea>
      <input aria-label="Nostr references" placeholder="npub/note/naddr/wss refs" bind:value={refsText} />
      <button type="submit">Save</button>
    </form>

    <section class="entries" aria-label="Journal entries">
      {#each results as entry}
        <button
          type="button"
          class="entry"
          class:selected={selected?.id === entry.id}
          onclick={() => selectEntry(entry)}
        >
          <span class="date">{formatDate(entry.updatedAt)}</span>
          <span class="title">{entry.title}</span>
          <span class="preview">{entry.body}</span>
        </button>
      {/each}
      {#if results.length === 0}
        <p class="empty">No journal entries yet.</p>
      {/if}
    </section>

    <aside class="detail">
      {#if selected}
        <p class="eyebrow">{formatDate(selected.updatedAt)}</p>
        <h2>{selected.title}</h2>
        <p>{selected.body}</p>
        <div class="refs">
          {#each selected.refs as ref}
            <button type="button" class="ref" onclick={() => openRef(ref)}>{ref}</button>
          {/each}
        </div>
      {:else}
        <p class="empty">No journal entry selected.</p>
      {/if}
    </aside>
  </section>
</main>

<style>
  :global(body) {
    margin: 0;
    background: var(--hg-bg, #070707);
    color: var(--hg-text, #f3f1e8);
    font-family: var(--hg-font-body, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  }

  .journal-shell {
    height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .toolbar {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--hg-border, #303030);
    background: var(--hg-surface, #101010);
  }

  .toolbar input {
    flex: 1;
  }

  h2, p {
    margin: 0;
    letter-spacing: 0;
  }

  h2 {
    font-size: 16px;
  }

  .eyebrow, .date {
    color: var(--hg-accent, #9ee493);
    font-size: 11px;
    text-transform: uppercase;
  }

  input, textarea, button {
    border: 1px solid var(--hg-border, #303030);
    border-radius: 6px;
    background: var(--hg-surface, #111);
    color: var(--hg-text, #f3f1e8);
    font: inherit;
    padding: 8px 10px;
  }

  textarea {
    min-height: 92px;
    resize: vertical;
  }

  button {
    cursor: pointer;
  }

  button:hover, button.selected, input:focus, textarea:focus {
    border-color: var(--hg-accent, #9ee493);
    outline: none;
  }

  .content {
    min-height: 0;
    flex: 1;
    display: grid;
    grid-template-columns: minmax(230px, 0.75fr) minmax(0, 1fr) minmax(260px, 0.8fr);
  }

  .editor, .entries, .detail {
    padding: 12px;
    min-width: 0;
  }

  .editor {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-right: 1px solid var(--hg-border, #303030);
  }

  .entries {
    overflow: auto;
  }

  .entry {
    width: 100%;
    display: grid;
    grid-template-columns: 68px minmax(110px, 0.4fr) minmax(0, 1fr);
    gap: 10px;
    text-align: left;
    margin-bottom: 8px;
  }

  .preview {
    color: var(--hg-text-muted, #b8b1a4);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .detail {
    border-left: 1px solid var(--hg-border, #303030);
    background: var(--hg-surface, #101010);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .refs {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .ref {
    color: var(--hg-accent-cyan, #82d8f7);
    overflow-wrap: anywhere;
    text-align: left;
  }

  .empty {
    color: var(--hg-text-muted, #b8b1a4);
  }

  @media (max-width: 860px) {
    .toolbar, .content {
      display: flex;
      flex-direction: column;
    }

    .editor, .detail {
      border: 0;
      border-bottom: 1px solid var(--hg-border, #303030);
    }

    .entry {
      grid-template-columns: 1fr;
    }
  }
</style>
