import * as THREE from 'three';

type Item = { el: HTMLElement; anchor: THREE.Object3D; y: number; start: number; until: number };

/** Emoji speech bubbles: HTML elements that follow a 3D object around the screen. */
export class Bubbles {
  private items: Item[] = [];
  private v = new THREE.Vector3();

  constructor(private layer: HTMLElement, private camera: THREE.Camera) {}

  show(anchor: THREE.Object3D, y: number, text: string, delay = 0, duration = 2.4) {
    const now = performance.now() / 1000;
    this.items = this.items.filter((i) => {
      if (i.anchor !== anchor) return true;
      i.el.remove();
      return false;
    });
    const el = document.createElement('div');
    el.className = 'bubble';
    el.textContent = text;
    el.style.display = 'none';
    this.layer.append(el);
    this.items.push({ el, anchor, y, start: now + delay, until: now + delay + duration });
  }

  update(width: number, height: number) {
    const now = performance.now() / 1000;
    this.items = this.items.filter((item) => {
      if (now > item.until) {
        item.el.remove();
        return false;
      }
      if (now < item.start) return true;
      item.anchor.getWorldPosition(this.v);
      this.v.y += item.y;
      this.v.project(this.camera);
      const visible = this.v.z < 1;
      item.el.style.display = visible ? '' : 'none';
      const x = ((this.v.x + 1) / 2) * width;
      const y = ((1 - this.v.y) / 2) * height;
      item.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      item.el.classList.toggle('fade', item.until - now < 0.3);
      return true;
    });
  }

  clear() {
    for (const i of this.items) i.el.remove();
    this.items = [];
  }
}
