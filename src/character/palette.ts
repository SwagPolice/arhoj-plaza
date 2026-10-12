// Soft glaze colours in the spirit of Studio Arhoj ceramics.
export type Swatch = { name: string; hex: string };

export const GLAZES: Swatch[] = [
  { name: 'Cream', hex: '#efe5d0' },
  { name: 'Oat', hex: '#dcc8a6' },
  { name: 'Blush', hex: '#f2b8ae' },
  { name: 'Coral', hex: '#ec8a6a' },
  { name: 'Rust', hex: '#c4643c' },
  { name: 'Mustard', hex: '#e2b23f' },
  { name: 'Mint', hex: '#a9d6c3' },
  { name: 'Sage', hex: '#9db58a' },
  { name: 'Sky', hex: '#a7cbe3' },
  { name: 'Cobalt', hex: '#3d5ea6' },
  { name: 'Plum', hex: '#8b5b7c' },
  { name: 'Ink', hex: '#3a3a44' },
];

export const CLAY = '#d9c2a0'; // unglazed bottom
export const INK = '#2b2420'; // face details
export const BLUSH = '#f39e98';
export const CREAM = '#f6efe2';
export const WHITE = '#fffaf2';
