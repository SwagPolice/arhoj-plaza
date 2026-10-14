import * as THREE from 'three';
import { IslandView } from '../scene/island-view';
import type { IslandLayout } from '../scene/layout';
import { randomRecipe, type CharacterRecipe } from '../character/recipe';
import { loadAll, loadIsland, removeAll, saveIsland, saveOne } from '../storage';
import { button, el } from '../ui/dom';
import { Decorator } from './decorate';

const PERSONALITY_ICON: Record<string, string> = { calm: '🍵', curious: '🔍', shy: '🌱', bouncy: '🎵' };

type Hooks = { edit(recipe: CharacterRecipe): void; create(): void };

/** Creative Mode's plaza: everyone you've made, plus Decorate, inviting friends and editing. */
export class Plaza extends IslandView {
  private decorator: Decorator;
  private tools = el('div', 'plaza-tools');
  private card = el('div', 'card');
  private empty = el('div', 'empty');

  constructor(renderer: THREE.WebGLRenderer, env: THREE.Texture, uiRoot: HTMLElement, private hooks: Hooks) {
    super(renderer, env, uiRoot, loadIsland());

    this.decorator = new Decorator({
      canvas: renderer.domElement,
      camera: this.camera,
      controls: this.controls,
      ui: this.layer,
      layout: () => this.layout,
      island: () => this.island,
      commit: (layout) => this.applyLayout(layout),
      done: () => this.setDecorating(false),
    });

    this.empty.append(
      el('h2', '', 'Nobody lives here yet'),
      el('p', 'muted', 'Make a character, or invite a few random friends to get things going.'),
      button('Invite 6 random friends', 'btn primary', () => this.invite(6)),
      button('Make a character', 'btn', () => this.hooks.create()),
    );
    this.tools.append(
      button('🛠 Decorate', 'btn', () => this.setDecorating(true)),
      button('🧹 Clear plaza', 'btn', () => this.clearAll()),
      button('＋ Random friend', 'btn', () => this.invite(1)),
      button('✏️ Make new', 'btn', () => this.hooks.create()),
    );
    this.card.style.display = 'none';
    this.addUI(this.card, this.empty, this.tools);
  }

  enter() {
    super.enter();
    this.sync();
  }

  leave() {
    if (this.decorator.active) this.setDecorating(false);
    super.leave();
    this.card.style.display = 'none';
  }

  /** An island from a share link: ask first, since it replaces the current one. */
  importIsland(layout: IslandLayout, fromNewer: boolean) {
    if (!confirm('Someone shared an island with you. Replace your island with it? Your current layout will be lost.')) return;
    this.applyLayout(layout);
    this.decorator.syncAfterImport();
    this.returnToIsland();
    this.toast(fromNewer ? 'Island imported. It was made with a newer version, so some things may be missing.' : 'Island imported!');
  }

  // ---------- IslandView hooks ----------

  protected saveLayout(layout: IslandLayout) {
    saveIsland(layout);
  }

  // While decorating, everyone holds still and the camera may zoom out further.
  protected get frozen() {
    return !!this.decorator?.active;
  }
  protected get wideView() {
    return !!this.decorator?.active;
  }

  protected onUpdate(dt: number) {
    this.decorator.update(dt, this.w, this.h);
  }

  protected onLayoutApplied() {
    this.decorator?.refresh();
  }

  protected onTap(e: PointerEvent) {
    if (this.decorator.active) return; // taps belong to the decorations
    const agent = this.pickAgent(e);
    if (!agent) {
      this.card.style.display = 'none';
      return;
    }
    agent.lookAt(this.camera.position.x, this.camera.position.z, 3);
    this.say(agent, '😊');
    this.showCard(agent.recipe);
  }

  // ---------- decorating ----------

  private setDecorating(on: boolean) {
    if (on === this.decorator.active) return;
    this.tools.style.display = on ? 'none' : '';
    this.card.style.display = 'none';
    this.bubbles.clear();
    // Characters step off the island while decorating, so anything can go anywhere.
    for (const a of this.agents) a.built.root.visible = !on;
    if (on) {
      this.empty.style.display = 'none';
      this.decorator.enter();
    } else {
      this.decorator.leave();
      this.empty.style.display = this.agents.length ? 'none' : '';
      this.returnToIsland();
    }
    this.fitToIsland();
  }

  // ---------- characters ----------

  /** Bring the plaza in line with what's saved. */
  private sync() {
    const list = loadAll();
    this.syncAgents(list);
    this.empty.style.display = list.length || this.decorator.active ? 'none' : '';
  }

  private invite(count: number) {
    for (let i = 0; i < count; i++) saveOne(randomRecipe());
    this.sync();
  }

  private clearAll() {
    const count = this.agents.length;
    if (!count || !confirm(`Say goodbye to all ${count} characters? This can't be undone.`)) return;
    removeAll();
    this.card.style.display = 'none';
    this.bubbles.clear();
    this.sync();
  }

  private showCard(r: CharacterRecipe) {
    const actions = el('div', 'card-actions');
    actions.append(
      button('Edit', 'btn primary', () => this.hooks.edit(r)),
      button('Close', 'btn', () => (this.card.style.display = 'none')),
    );
    this.card.replaceChildren(
      el('div', 'card-name', r.name || 'Unnamed'),
      el('div', 'muted', `${PERSONALITY_ICON[r.personality]} ${r.personality} ${r.body}`),
      actions,
    );
    this.card.style.display = '';
  }
}
