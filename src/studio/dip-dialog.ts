import * as THREE from 'three';
import { buildCharacter, disposeObject } from '../character/build';
import { EDGES, type CharacterRecipe, type Edge } from '../character/recipe';
import { addLights, createEnvironment, glaze } from '../scene/stage';
import { button, el } from '../ui/dom';
import { openDialog, row } from '../ui/share-dialogs';
import type { DipShape } from './economy';

export type Paint = { colour: string; name: string; n: number };

const EDGE_LABELS: Record<Edge, string> = { clean: 'Clean', wavy: 'Wavy', drips: 'Drips', fade: 'Fade' };

/**
 * The dip dialog: pick a paint you own, how far the dip reaches and its edge, and see the character turning in
 * a little preview as it would come out. `preview` is the dip rule itself (so what you see is what you get);
 * the paint is only spent when you press Dip.
 */
export function openDipDialog(o: {
  name: string;
  first: boolean; // the first dip (it covers the foot), or one over the glaze
  depth: number; // where the depth slider starts (0 to 1)
  paints: Paint[];
  preview: (colour: string, shape: DipShape) => CharacterRecipe | null;
  dip: (colour: string, shape: DipShape) => void;
}) {
  let colour = o.paints[0].colour;
  let depth = o.depth;
  let edge: Edge = 'clean';

  // A tiny scene of its own: the character on a plinth, turning slowly.
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(200, 220);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  const env = createEnvironment(renderer);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f6efe4');
  scene.environment = env;
  scene.environmentIntensity = 0.55;
  addLights(scene, 2, new THREE.Vector3(3, 6, 5));
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.16, 48), glaze('#e9dfcd', { roughness: 0.5, clearcoat: 0.3 }));
  plinth.position.y = -0.08;
  plinth.receiveShadow = true;
  const turntable = new THREE.Group();
  scene.add(plinth, turntable);
  const camera = new THREE.PerspectiveCamera(30, 200 / 220, 0.1, 50);
  camera.position.set(0, 1.4, 4.6);
  camera.lookAt(0, 0.62, 0);
  let built: THREE.Object3D | null = null;

  const redraw = () => {
    const r = o.preview(colour, { depth, edge });
    if (!r) return;
    if (built) {
      turntable.remove(built);
      disposeObject(built);
    }
    built = buildCharacter(r).root;
    built.traverse((x) => {
      if (x instanceof THREE.Mesh) x.castShadow = true;
    });
    turntable.add(built);
  };
  renderer.setAnimationLoop((t: number) => {
    turntable.rotation.y = Math.sin(t / 1600) * 0.7; // to and fro, so the front stays in view
    renderer.render(scene, camera);
  });

  const paints = el('div', 'chips');
  const edges = el('div', 'chips');
  const drawChips = () => {
    paints.replaceChildren(
      ...o.paints.map((p) => {
        const b = button('', 'chip' + (p.colour === colour ? ' on' : ''), () => ((colour = p.colour), drawChips(), redraw()));
        const dot = el('span', 'swatch-dot');
        dot.style.background = p.colour;
        b.append(dot, `${p.name} (${p.n})`);
        return b;
      }),
    );
    edges.replaceChildren(...EDGES.map((e) => button(EDGE_LABELS[e], 'chip' + (e === edge ? ' on' : ''), () => ((edge = e), drawChips(), redraw()))));
  };
  drawChips();

  const slider = el('label', 'slider');
  const input = el('input');
  input.type = 'range';
  input.min = '0';
  input.max = '1';
  input.step = '0.01';
  input.value = String(depth);
  input.addEventListener('input', () => {
    depth = parseFloat(input.value);
    redraw();
  });
  slider.append(input); // the heading above says what it does

  const preview = el('div', 'dip-preview');
  preview.append(renderer.domElement);
  const controls = el('div', 'dip-controls');
  controls.append(
    el('div', 'sub', 'Paint'), paints,
    el('div', 'sub', o.first ? 'How much of the foot it covers' : 'How far it reaches from the top'), slider,
    el('div', 'sub', o.first ? 'Where it meets the clay' : 'Its bottom edge'), edges,
  );
  const body = el('div', 'dip-body');
  body.append(preview, controls);
  const dialog = openDialog(o.first ? `Dip ${o.name}` : `Dip ${o.name} again`, [
    el('p', 'muted', o.first ? 'One paint for a glossy glaze.' : 'One paint for a new layer over the last. The more layers, the more often it drops paint, in any of its colours.'),
    body,
    row(
      button('Dip', 'btn primary', () => {
        o.dip(colour, { depth, edge });
        dialog.close();
      }),
      button('Cancel', 'btn', () => dialog.close()),
    ),
  ]);
  dialog.classList.add('dip-dialog');
  dialog.addEventListener('close', () => {
    renderer.setAnimationLoop(null);
    if (built) disposeObject(built);
    env.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  });
  redraw();
}
