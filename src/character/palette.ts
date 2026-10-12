// Glaze colours in the spirit of Studio Arhoj ceramics.
export type Swatch = { name: string; hex: string };

export const GLAZES: Swatch[] = [
  { name: 'White', hex: '#f7f4ee' },
  { name: 'Cream', hex: '#efe5d0' },
  { name: 'Blush', hex: '#f2b8ae' },
  { name: 'Lilac', hex: '#c9b6e4' },
  { name: 'Sky', hex: '#9fd0ee' },
  { name: 'Mint', hex: '#a9e0c8' },
  { name: 'Lime', hex: '#d6ec8a' },
  { name: 'Yellow', hex: '#f2c230' },
  { name: 'Orange', hex: '#f08a24' },
  { name: 'Coral', hex: '#ec8a6a' },
  { name: 'Red', hex: '#d8382f' },
  { name: 'Rust', hex: '#a8502c' },
  { name: 'Moss', hex: '#6f8a3a' },
  { name: 'Green', hex: '#1f8a55' },
  { name: 'Teal', hex: '#3fae9a' },
  { name: 'Cobalt', hex: '#2f55b5' },
  { name: 'Plum', hex: '#7a4a7c' },
  { name: 'Black', hex: '#24232a' },
];

// Lustre glazes: rendered as real metal.
export const METALS: Swatch[] = [
  { name: 'Gold', hex: '#e0ad4a' },
  { name: 'Copper', hex: '#c97a4e' },
  { name: 'Silver', hex: '#cfd3d8' },
  { name: 'Bronze', hex: '#94683e' },
];

export const CLAY = '#d9bd94'; // unglazed stoneware
export const INK = '#1f1b19'; // face details
export const BLUSH = '#f39e98';
export const CREAM = '#f6efe2';
export const WHITE = '#fffdf8';
export const MOUTH_RED = '#d8382f';
