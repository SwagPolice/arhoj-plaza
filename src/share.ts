import { isFromNewerVersion, newId, normaliseRecipe, RECIPE_VERSION, type CharacterRecipe } from './character/recipe';
import { LAYOUT_VERSION, normaliseLayout, type IslandLayout } from './scene/layout';

/*
 * Share codes: data as compressed JSON, written with URL-safe characters.
 * The prefix says what kind of code it is ("arhoj1." characters, "arhojisle1." islands); the data inside
 * carries its own version (see recipe.ts and layout.ts), so codes made today keep working as the game grows.
 */
const PREFIX = 'arhoj1.';
const ISLAND_PREFIX = 'arhojisle1.';

export class ShareError extends Error {}

export async function encodeCharacter(r: CharacterRecipe): Promise<string> {
  const data: Partial<CharacterRecipe> & { v: number } = { v: RECIPE_VERSION, ...r };
  delete data.id; // every imported copy gets its own id
  return PREFIX + (await pack(data));
}

export async function encodeIsland(layout: IslandLayout): Promise<string> {
  // Ids are left out to keep codes short; the importing island makes its own.
  const items = layout.items.map(({ id: _, ...rest }) => rest);
  return ISLAND_PREFIX + (await pack({ v: LAYOUT_VERSION, radius: layout.radius, items }));
}

export const islandLink = (code: string) => `${location.origin}${location.pathname}#island=${code}`;

/** Read an island code (or a whole island link). */
export async function decodeIsland(input: string): Promise<{ layout: IslandLayout; fromNewer: boolean }> {
  const text = codeFrom(input, '#island=');
  if (text.startsWith(PREFIX)) throw new ShareError('That\'s a character code. Import it in the ✏️ Make tab instead.');
  if (!text.startsWith(ISLAND_PREFIX)) throw new ShareError("That doesn't look like an island code.");
  const raw = await unpack(text.slice(ISLAND_PREFIX.length));
  const v = (raw as { v?: unknown }).v;
  return { layout: normaliseLayout(raw), fromNewer: typeof v === 'number' && v > LAYOUT_VERSION };
}

export const shareLink = (code: string) => `${location.origin}${location.pathname}#import=${code}`;

/** Read a code (or a whole share link). Always gives a new, unsaved character. */
export async function decodeCharacter(input: string): Promise<{ recipe: CharacterRecipe; fromNewer: boolean }> {
  const text = codeFrom(input, '#import=');
  if (text.startsWith(ISLAND_PREFIX)) throw new ShareError("That's an island code. Import it from 🛠 Decorate in the plaza instead.");
  if (!text.startsWith(PREFIX)) throw new ShareError("That doesn't look like a character code.");
  const raw = await unpack(text.slice(PREFIX.length));
  return { recipe: { ...normaliseRecipe(raw), id: newId() }, fromNewer: isFromNewerVersion(raw) };
}

/** The code part of pasted text: accepts a bare code or a whole link, ignores spaces and line breaks. */
function codeFrom(input: string, linkKey: string) {
  let text = input.trim();
  const link = text.indexOf(linkKey);
  if (link >= 0) text = text.slice(link + linkKey.length);
  return text.replace(/\s+/g, '');
}

async function pack(data: unknown): Promise<string> {
  return toBase64Url(await pipe(new TextEncoder().encode(JSON.stringify(data)), new CompressionStream('deflate-raw')));
}

async function unpack(body: string): Promise<object> {
  let raw: unknown;
  try {
    const bytes = await pipe(fromBase64Url(body), new DecompressionStream('deflate-raw'));
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ShareError('This code seems incomplete or damaged. Try copying it again.');
  }
  if (!raw || typeof raw !== 'object') throw new ShareError('This code seems incomplete or damaged. Try copying it again.');
  return raw;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
