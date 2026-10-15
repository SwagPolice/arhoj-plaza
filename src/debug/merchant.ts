import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Mode } from '../mode';
import { addLights, PAPER } from '../scene/stage';
import { buildCharacter } from '../character/build';
import { defaultRecipe } from '../character/recipe';
import { buildMerchant } from '../studio/merchant-model';

/** Open with ?debug=merchant to look at the balloon merchant floating at his first size, by a ghost for scale. */
export class DebugMerchant implements Mode {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  private controls: OrbitControls;
  private floating: THREE.Group;

  constructor(renderer: THREE.WebGLRenderer, env: THREE.Texture) {
    this.scene.background = new THREE.Color(PAPER);
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.55;
    addLights(this.scene, 6);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.12 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const ghost = buildCharacter({ ...defaultRecipe(), body: 'ghost' }).root;
    ghost.position.x = -0.9;
    this.floating = buildMerchant(5).root;
    this.floating.scale.setScalar(1.6);
    this.floating.position.set(0.9, 1.3, -0.4);
    this.scene.add(ghost, this.floating);

    this.camera.position.set(0.2, 2, 8);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.target.set(0.2, 1.4, 0);
  }

  enter() {}
  leave() {}
  update(_dt: number, t: number) {
    this.controls.update();
    this.floating.position.y = 1.3 + Math.sin(t * 1.1) * 0.08;
    this.floating.rotation.z = Math.sin(t * 0.7) * 0.04;
  }
  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
