<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { inc as ipc, type Subscription } from '@napplet/sdk';
  import { createIntentRequest, parseIntentResult, type IntentRequest } from '@hyprgate/types';
  import {
    invokeNappletIntent,
    WORKSPACE_JOURNAL_CAPTURE_TOPIC,
    createNoteViewerOpenIntentRequest,
    createNoteViewerOpenPayload,
    createProfileIntentRequest,
    parseWorkspaceJournalCapturePayload,
    resourceImage,
  } from '@hyprgate/utils';
  import {
    captureJournalEntry,
    createJournalEntry,
    deleteJournalEntry,
    persistJournalState,
    restoreJournalEntry,
    restoreJournalState,
    searchJournalEntries,
    selectedJournalEntry,
    updateJournalEntry,
    type JournalEntry,
    type JournalState,
  } from './lib/workspace-journal-store';
  import { fallbackRefLabel, resolveRef, subscribeRefMetadata, type RefMetadata } from './lib/journal-refs';

  let state = $state.raw<JournalState>({ entries: [], query: '', selectedId: null });
  let loaded = $state(false);
  let title = $state('');
  let body = $state('');
  let refsText = $state('');
  let editorError = $state<string | null>(null);
  // null = reading; 'new' = writing; otherwise the id of the entry being edited.
  let editing = $state<string | null>(null);
  let confirmingDelete = $state(false);
  let deleted = $state.raw<JournalEntry | null>(null);
  let paneOpen = $state(false);
  let refMessage = $state<string | null>(null);
  let refMetadata = $state.raw<Record<string, RefMetadata>>({});
  let titleInput = $state<HTMLInputElement | null>(null);
  let bodyInput = $state<HTMLTextAreaElement | null>(null);
  let refSub: Subscription | null = null;

  const results = $derived(searchJournalEntries(state));
  const selected = $derived(selectedJournalEntry(state));
  const allRefs = $derived([...new Set(state.entries.flatMap((entry) => entry.refs))].join('\n'));
  // With nothing written yet, the editor is the whole app.
  const showingEditor = $derived(editing !== null || (loaded && state.entries.length === 0));
  const isFirstEntry = $derived(state.entries.length === 0);

  onMount(() => {
    restoreJournalState().then((restored) => {
      state = restored;
      loaded = true;
    });
    const sub = ipc.on(WORKSPACE_JOURNAL_CAPTURE_TOPIC, (event) => {
      const capture = parseWorkspaceJournalCapturePayload(event.payload);
      if (!capture) return;
      state = captureJournalEntry(state, capture);
      persistJournalState(state);
    });
    return () => {
      sub.close();
      refSub?.close();
    };
  });

  $effect(() => {
    const refs = allRefs ? allRefs.split('\n') : [];
    refSub?.close();
    refSub = subscribeRefMetadata(refs, (ref, metadata) => {
      refMetadata = { ...refMetadata, [ref]: metadata };
    });
  });

  function resetEditor(): void {
    title = '';
    body = '';
    refsText = '';
    editorError = null;
  }

  function selectEntry(entry: JournalEntry): void {
    state = { ...state, selectedId: entry.id };
    editing = null;
    confirmingDelete = false;
    refMessage = null;
    paneOpen = true;
    persistJournalState(state);
  }

  function setQuery(value: string): void {
    state = { ...state, query: value };
    persistJournalState(state);
  }

  async function startNew(): Promise<void> {
    resetEditor();
    editing = 'new';
    paneOpen = true;
    await tick();
    bodyInput?.focus();
  }

  async function startEdit(entry: JournalEntry): Promise<void> {
    title = entry.title;
    body = entry.body;
    refsText = entry.refs.join(' ');
    editorError = null;
    editing = entry.id;
    confirmingDelete = false;
    paneOpen = true;
    await tick();
    titleInput?.focus();
  }

  function cancelEdit(): void {
    resetEditor();
    editing = null;
    paneOpen = false;
  }

  function saveEntry(): void {
    if (!body.trim()) {
      editorError = 'Write something first.';
      bodyInput?.focus();
      return;
    }
    state = editing && editing !== 'new'
      ? updateJournalEntry(state, editing, { title, body, refsText })
      : createJournalEntry(state, { title, body, refsText });
    deleted = null;
    if (state.query && !searchJournalEntries(state).some((entry) => entry.id === state.selectedId)) {
      state = { ...state, query: '' };
    }
    resetEditor();
    editing = null;
    persistJournalState(state);
  }

  // Forms don't submit under sandbox=allow-scripts, so these keys are handled by hand.
  function saveOnEnter(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    saveEntry();
  }

  function saveOnModEnter(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      saveEntry();
    }
  }

  function deleteEntry(entry: JournalEntry): void {
    deleted = entry;
    state = deleteJournalEntry(state, entry.id);
    confirmingDelete = false;
    paneOpen = false;
    persistJournalState(state);
  }

  function undoDelete(): void {
    if (!deleted) return;
    state = restoreJournalEntry(state, deleted);
    deleted = null;
    persistJournalState(state);
  }

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  async function invokeNavigation(request: IntentRequest | null): Promise<void> {
    if (!request) {
      refMessage = "This link can't be opened.";
      return;
    }
    try {
      const result = parseIntentResult(await invokeNappletIntent(request));
      if (!result?.ok) refMessage = 'Nothing is available to open this right now.';
    } catch {
      refMessage = 'Nothing is available to open this right now.';
    }
  }

  async function openRef(ref: string): Promise<void> {
    refMessage = null;
    const resolved = resolveRef(ref);
    if (!resolved) {
      refMessage = "This link can't be opened.";
      return;
    }
    if (resolved.kind === 'relay') {
      await invokeNavigation(createIntentRequest({ archetype: 'relay-browser', action: 'inspect', payload: { relay: resolved.url } }));
      return;
    }
    if (resolved.kind === 'profile') {
      await invokeNavigation(createProfileIntentRequest({ pubkey: resolved.pubkey }));
      return;
    }
    // The note app locates an address through its nip19 form, and an event's can carry relay hints.
    const target = resolved.kind === 'event'
      ? { type: 'event' as const, id: resolved.id, nip19: ref }
      : { type: 'address' as const, ...resolved.address, nip19: ref };
    const payload = createNoteViewerOpenPayload({
      target,
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
      placeholder="Search your entries"
      value={state.query}
      oninput={(event) => setQuery(event.currentTarget.value)}
    />
    {#if !showingEditor}
      <button type="button" class="primary" onclick={startNew}>New entry</button>
    {/if}
  </header>

  {#if deleted}
    <div class="note-bar" role="status">
      <span>Deleted “{deleted.title}”</span>
      <button type="button" class="link" onclick={undoDelete}>Undo</button>
    </div>
  {/if}

  <section class="content" class:pane-open={paneOpen || isFirstEntry} class:first-entry={isFirstEntry}>
    {#if !isFirstEntry}
      <section class="entries" aria-label="Journal entries">
        {#each results as entry (entry.id)}
          <button
            type="button"
            class="entry"
            class:selected={editing === null && selected?.id === entry.id}
            aria-current={selected?.id === entry.id ? 'true' : undefined}
            onclick={() => selectEntry(entry)}
          >
            <span class="date">{formatDate(entry.updatedAt)}</span>
            <span class="title">{entry.title}</span>
            {#if entry.body !== entry.title}<span class="preview">{entry.body}</span>{/if}
          </button>
        {/each}
        {#if results.length === 0}
          <div class="empty">
            <p class="empty-title">No entries match “{state.query.trim()}”</p>
            <button type="button" onclick={() => setQuery('')}>Clear search</button>
          </div>
        {/if}
      </section>
    {/if}

    <section class="pane" aria-label={showingEditor ? 'Write an entry' : 'Entry'}>
      {#if !isFirstEntry}
        <button type="button" class="back" onclick={cancelEdit}>Back to your entries</button>
      {/if}
      {#if showingEditor}
        <div class="editor" role="group" aria-label="Entry editor">
          {#if isFirstEntry && editing === null}
            <div class="intro">
              <h2>Start your journal</h2>
              <p class="muted">Keep timestamped notes about what you're doing, with links to the notes, people and relays involved. Entries are kept in this app's storage.</p>
            </div>
          {/if}
          <input
            bind:this={titleInput}
            aria-label="Entry title"
            placeholder="Title (optional)"
            bind:value={title}
            onkeydown={saveOnEnter}
          />
          <textarea
            bind:this={bodyInput}
            aria-label="Entry body"
            aria-invalid={!!editorError}
            placeholder="What happened?"
            bind:value={body}
            oninput={() => (editorError = null)}
            onkeydown={saveOnModEnter}
          ></textarea>
          <input
            aria-label="Links to notes, people or relays"
            placeholder="Links to notes, people or relays (optional): note1..., npub1..., wss://..."
            bind:value={refsText}
            onkeydown={saveOnEnter}
          />
          {#if editorError}<p class="error" role="alert">{editorError}</p>{/if}
          <div class="actions">
            <button type="button" class="primary" onclick={saveEntry}>{editing && editing !== 'new' ? 'Save changes' : 'Save entry'}</button>
            {#if !isFirstEntry || editing !== null}
              <button type="button" onclick={cancelEdit}>Cancel</button>
            {/if}
          </div>
        </div>
      {:else if selected}
        <article class="detail">
          <p class="eyebrow">{formatDate(selected.updatedAt)}{selected.updatedAt !== selected.createdAt ? ' (edited)' : ''}</p>
          <h2>{selected.title}</h2>
          {#if selected.body !== selected.title}<p class="body-text">{selected.body}</p>{/if}
          {#if selected.refs.length > 0}
            <div class="refs" aria-label="Links in this entry">
              {#each selected.refs as ref (ref)}
                {@const resolved = resolveRef(ref)}
                {@const info = refMetadata[ref]}
                <button type="button" class="ref" title={ref} onclick={() => openRef(ref)}>
                  {#if resolved?.kind === 'profile'}
                    <span class="avatar" aria-hidden="true">
                      <span>{info?.label?.slice(0, 1).toUpperCase() ?? '?'}</span>
                      {#if info?.picture}<img use:resourceImage={info.picture} alt="" loading="lazy" />{/if}
                    </span>
                  {/if}
                  <span class="ref-label">{info?.label || fallbackRefLabel(ref, resolved)}</span>
                </button>
              {/each}
            </div>
            {#if refMessage}<p class="error" role="alert">{refMessage}</p>{/if}
          {/if}
          {#if confirmingDelete}
            <div class="confirm" role="group" aria-label="Confirm delete">
              <span>Delete this entry?</span>
              <button type="button" class="danger" onclick={() => deleteEntry(selected)}>Yes, delete</button>
              <button type="button" onclick={() => (confirmingDelete = false)}>Keep it</button>
            </div>
          {:else}
            <div class="actions">
              <button type="button" onclick={() => startEdit(selected)}>Edit</button>
              <button type="button" class="danger-quiet" onclick={() => (confirmingDelete = true)}>Delete</button>
            </div>
          {/if}
        </article>
      {:else}
        <p class="muted none">Pick an entry to read it.</p>
      {/if}
    </section>
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
    gap: 8px;
    padding: 10px 12px;
    background: var(--hg-surface, #101010);
    border-bottom: 1px solid var(--hg-border, #303030);
  }

  input, textarea {
    box-sizing: border-box;
    min-width: 0;
    padding: 8px 10px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 6px;
    background: var(--hg-bg, #070707);
    color: var(--hg-text, #f3f1e8);
    font: inherit;
  }

  .toolbar input {
    flex: 1;
  }

  input:focus, textarea:focus {
    outline: none;
    border-color: var(--hg-accent, #9ee493);
  }

  textarea[aria-invalid='true'] {
    border-color: var(--hg-accent-danger, #ff6b6b);
  }

  button {
    border: 1px solid var(--hg-border, #303030);
    border-radius: 6px;
    background: var(--hg-surface, #111);
    color: var(--hg-text, #f3f1e8);
    font: inherit;
    padding: 7px 10px;
    cursor: pointer;
  }

  button:hover {
    border-color: var(--hg-accent, #9ee493);
  }

  button:focus-visible {
    outline: 2px solid var(--hg-accent, #9ee493);
    outline-offset: 1px;
  }

  .primary {
    border-color: var(--hg-accent, #9ee493);
    color: var(--hg-accent, #9ee493);
    white-space: nowrap;
  }

  .danger, .danger-quiet:hover {
    border-color: var(--hg-accent-danger, #ff6b6b);
    color: var(--hg-accent-danger, #ff6b6b);
  }

  .link {
    border: 0;
    background: none;
    padding: 0 2px;
    color: var(--hg-accent, #9ee493);
    text-decoration: underline;
  }

  h2, p {
    margin: 0;
    letter-spacing: 0;
  }

  h2 {
    font-size: 15px;
    overflow-wrap: anywhere;
  }

  .muted {
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 13px;
  }

  .error {
    color: var(--hg-accent-danger, #ff6b6b);
    font-size: 12px;
  }

  .note-bar {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 12px;
    font-size: 13px;
    color: var(--hg-text-muted, #b8b1a4);
    border-bottom: 1px solid var(--hg-border, #303030);
  }

  .note-bar span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .content {
    min-height: 0;
    flex: 1;
    display: grid;
    grid-template-columns: minmax(240px, 0.8fr) minmax(0, 1.2fr);
  }

  .content.first-entry {
    grid-template-columns: minmax(0, 1fr);
    justify-items: center;
  }

  .entries {
    min-width: 0;
    overflow: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-right: 1px solid var(--hg-border, #303030);
  }

  .entry {
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: none;
    min-width: 0;
    text-align: left;
    padding: 9px 10px;
  }

  .entry.selected {
    border-color: var(--hg-accent, #9ee493);
    background: color-mix(in srgb, var(--hg-accent, #9ee493) 10%, transparent);
  }

  .date, .eyebrow {
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 11px;
  }

  .title, .preview {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview {
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 12px;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 40px 12px;
    text-align: center;
  }

  .empty-title {
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .pane {
    min-width: 0;
    min-height: 0;
    width: 100%;
    overflow: auto;
    padding: 14px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .first-entry .pane {
    max-width: 640px;
  }

  .back {
    display: none;
    align-self: flex-start;
  }

  .editor {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 260px;
  }

  .intro {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 6px;
  }

  textarea {
    flex: 1;
    min-height: 140px;
    resize: none;
  }

  .actions, .confirm {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .detail {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .body-text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .refs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .ref {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    padding: 3px 9px 3px 5px;
    border-radius: 999px;
    font-size: 12px;
  }

  .ref-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .avatar {
    position: relative;
    display: inline-grid;
    place-items: center;
    flex: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    overflow: hidden;
    border: 1px solid var(--hg-border, #303030);
    font-size: 10px;
  }

  .avatar img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .none {
    padding: 40px 12px;
    text-align: center;
  }

  @media (max-width: 760px) {
    .content {
      grid-template-columns: minmax(0, 1fr);
    }

    .entries {
      border-right: 0;
    }

    .content:not(.first-entry) .pane {
      display: none;
    }

    .content.pane-open:not(.first-entry) .pane {
      display: flex;
    }

    .content.pane-open .entries {
      display: none;
    }

    .back {
      display: block;
    }
  }
</style>
