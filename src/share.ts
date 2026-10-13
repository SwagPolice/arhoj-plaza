import { isFromNewerVersion, newId, normaliseRecipe, RECIPE_VERSION, type CharacterRecipe } from './character/recipe';

/*
 * Share codes: a character recipe as compressed JSON, written with URL-safe characters.
 * "arhoj1." names the code format; the recipe inside carries its own version (see recipe.ts),
 * so codes made today keep working as the game grows.
 */
const PREFIX = 'arhoj1.';

export class ShareError extends Error {}

export async function encodeCharacter(r: CharacterRecipe): Promise<string> {
  const data: Partial<CharacterRecipe> & { v: number } = { v: RECIPE_VERSION, ...r };
  delete data.id; // every imported copy gets its own id
  const bytes = await pipe(new TextEncoder().encode(JSON.stringify(data)), new CompressionStream('deflate-raw'));
  return PREFIX + toBase64Url(bytes);
}

export const shareLink = (code: string) => `${location.origin}${location.pathname}#import=${code}`;

/** Read a code (or a whole share link). Always gives a new, unsaved character. */
export async function decodeCharacter(input: string): Promise<{ recipe: CharacterRecipe; fromNewer: boolean }> {
  let text = input.trim();
  const link = text.indexOf('#import=');
  if (link >= 0) text = text.slice(link + '#import='.length);
  text = text.replace(/\s+/g, '');
  if (!text.startsWith(PREFIX)) throw new ShareError("That doesn't look like a character code.");

  let raw: unknown;
  try {
    const bytes = await pipe(fromBase64Url(text.slice(PREFIX.length)), new DecompressionStream('deflate-raw'));
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ShareError('This code seems incomplete or damaged. Try copying it again.');
  }
  if (!raw || typeof raw !== 'object') throw new ShareError('This code seems incomplete or damaged. Try copying it again.');
  return { recipe: { ...normaliseRecipe(raw), id: newId() }, fromNewer: isFromNewerVersion(raw) };
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
