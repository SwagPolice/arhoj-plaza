import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Mode } from '../mode';
import { addLights, PAPER } from '../scene/stage';
import { buildCharacter } from '../character/build';
import { BODIES, randomRecipe } from '../character/recipe';

/** Open with ?debug=grid to see a lineup of random characters (one row per body shape). */
export class DebugGrid implements Mode {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  private controls: OrbitControls;

  constructor(renderer: THREE.WebGLRenderer, env: THREE.Texture) {
    this.scene.background = new THREE.Color(PAPER);
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.55;
    addLights(this.scene, 6);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.12 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    BODIES.forEach((body, row) => {
      for (let col = 0; col < 5; col++) {
        const built = buildCharacter({ ...randomRecipe(), body });
        built.root.position.set((col - 2) * 1.6, 0, (row - 2) * 1.6);
        this.scene.add(built.root);
      }
    });
    this.camera.position.set(0, 7, 11);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
  }

  enter() {}
  leave() {}
  update() {
    this.controls.update();
  }
  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
