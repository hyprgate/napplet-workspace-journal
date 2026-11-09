import { relay, type Subscription } from '@napplet/sdk';
import { parseNoteContent } from '@hyprgate/utils';
import type { NostrEvent } from '@hyprgate/types';

/** What a reference in an entry points at. */
export type JournalRef =
  | { kind: 'event'; id: string }
  | { kind: 'address'; address: { kind: number; pubkey: string; identifier: string } }
  | { kind: 'profile'; pubkey: string }
  | { kind: 'relay'; url: string };

export function resolveRef(ref: string): JournalRef | null {
  const value = ref.trim();
  if (/^wss?:\/\/\S+$/i.test(value)) return { kind: 'relay', url: value };
  if (!/^(npub|nprofile|note|nevent|naddr)1[a-z0-9]+$/i.test(value)) return null;
  const [block] = parseNoteContent(`nostr:${value}`);
  if (block?.type === 'profile') return { kind: 'profile', pubkey: block.value };
  if (block?.type === 'event') return { kind: 'event', id: block.value };
  if (block?.type === 'address') {
    const [kind, pubkey, ...identifier] = block.value.split(':');
    const parsedKind = Number(kind);
    if (Number.isInteger(parsedKind) && pubkey) {
      return { kind: 'address', address: { kind: parsedKind, pubkey, identifier: identifier.join(':') } };
    }
  }
  return null;
}

export interface RefMetadata {
  label?: string;
  picture?: string;
}

export function metadataFromEvent(event: NostrEvent): RefMetadata | null {
  if (event.kind === 0) {
    try {
      const profile = JSON.parse(event.content) as Record<string, unknown>;
      const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
      return {
        label: text(profile.display_name) ?? text(profile.displayName) ?? text(profile.name) ?? text(profile.nip05),
        picture: text(profile.picture),
      };
    } catch {
      return null;
    }
  }
  const title = event.tags.find((tag) => (tag[0] === 'title' || tag[0] === 'name') && tag[1])?.[1];
  const line = event.content.split('\n').map((text) => text.trim()).find(Boolean) ?? '';
  return { label: title ?? (line.length > 70 ? `${line.slice(0, 70).trimEnd()}...` : line) };
}

/** Short text for a reference nothing has been learned about yet. */
export function fallbackRefLabel(ref: string, resolved: JournalRef | null): string {
  if (resolved?.kind === 'relay') return resolved.url.replace(/^wss?:\/\//, '');
  return ref.length > 24 ? `${ref.slice(0, 12)}...${ref.slice(-6)}` : ref;
}

/** Look up names for people and text for notes. Unknowns simply never arrive. */
export function subscribeRefMetadata(refs: string[], onMetadata: (ref: string, metadata: RefMetadata) => void): Subscription {
  const refsByKey = new Map<string, string[]>();
  const ids: string[] = [];
  const authors: string[] = [];
  const filters: Array<Record<string, unknown>> = [];
  const remember = (key: string, ref: string) => refsByKey.set(key, [...(refsByKey.get(key) ?? []), ref]);
  for (const ref of refs) {
    const resolved = resolveRef(ref);
    if (resolved?.kind === 'event') {
      ids.push(resolved.id);
      remember(`event:${resolved.id}`, ref);
    } else if (resolved?.kind === 'profile') {
      authors.push(resolved.pubkey);
      remember(`profile:${resolved.pubkey}`, ref);
    } else if (resolved?.kind === 'address') {
      const { kind, pubkey, identifier } = resolved.address;
      filters.push({ kinds: [kind], authors: [pubkey], '#d': [identifier] });
      remember(`address:${kind}:${pubkey}:${identifier}`, ref);
    }
  }
  if (ids.length > 0) filters.push({ ids });
  if (authors.length > 0) filters.push({ kinds: [0], authors });
  if (filters.length === 0) return { close: () => {} };

  const newestAt = new Map<string, number>();
  return relay.subscribe(filters as never, (result) => {
    const event = result.event as NostrEvent;
    const metadata = metadataFromEvent(event);
    if (!metadata) return;
    const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1];
    const keys = [event.kind === 0 ? `profile:${event.pubkey}` : `event:${event.id}`, `address:${event.kind}:${event.pubkey}:${identifier}`];
    for (const key of keys) {
      if ((newestAt.get(key) ?? -1) > event.created_at) continue;
      for (const ref of refsByKey.get(key) ?? []) {
        newestAt.set(key, event.created_at);
        onMetadata(ref, metadata);
      }
    }
  }, () => {});
}
