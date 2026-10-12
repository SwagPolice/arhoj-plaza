import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const PAPER = '#f3ece1';

export function createRenderer(host: HTMLElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.append(renderer.domElement);
  return renderer;
}

/** A soft studio "room" reflected in the glaze — this is what makes things look glossy. */
export function createEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

export function addLights(scene: THREE.Scene, shadowExtent: number, keyPosition = new THREE.Vector3(4, 8, 5)) {
  const hemi = new THREE.HemisphereLight('#fff6e8', '#d9c6a8', 1.1);
  const key = new THREE.DirectionalLight('#fff1dc', 2.1);
  key.position.copy(keyPosition);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const cam = key.shadow.camera;
  cam.left = cam.bottom = -shadowExtent;
  cam.right = cam.top = shadowExtent;
  cam.near = 0.5;
  cam.far = keyPosition.length() * 2.5;
  key.shadow.radius = 5;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(hemi, key, key.target);
  return { hemi, key };
}

export function glaze(color: THREE.ColorRepresentation, extra: THREE.MeshPhysicalMaterialParameters = {}) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.12, ...extra });
}

export function makeCanvas(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!);
  return c;
}

export function canvasTexture(canvas: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Little dark flecks, like iron spots in stoneware clay. */
export function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, rand: () => number, count: number) {
  for (let i = 0; i < count; i++) {
    const dark = rand() < 0.85;
    ctx.fillStyle = dark ? `rgba(60,42,30,${0.25 + rand() * 0.5})` : 'rgba(255,250,240,0.6)';
    ctx.beginPath();
    ctx.arc(rand() * w, rand() * h, 0.5 + rand() * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
}
