import type * as THREE from 'three';

/** A screen of the game (editor, plaza…). main.ts renders whichever one is active. */
export interface Mode {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  enter(): void;
  leave(): void;
  update(dt: number, t: number): void;
  resize(width: number, height: number): void;
}
