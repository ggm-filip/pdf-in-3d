import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";

/*
 * The pointer as a lamp: a spot light hangs a little in front of the spot under the pointer (along the view ray),
 * so the light pool and the reflection on foil and SpotUV sit right where you point. While it is on, the rest of
 * the studio dims a little, as in a dark room with a torch. On a touch screen it follows the finger.
 */

export type LampKind = "off" | "spot" | "day" | "led" | "candle" | "rainbow";
export type LampSettings = { kind: LampKind; power: number }; // power 0..1
export const LAMP_KINDS: LampKind[] = ["off", "spot", "day", "led", "candle", "rainbow"];
export const LAMP_DEFAULT: LampSettings = { kind: "spot", power: 0.7 };

type Spec = {
  color: string; // light colour (the rainbow lamp turns through all hues)
  angle: number; // half the cone angle (radians): small = a tight spot, large = a broad, soft light
  penumbra: number; // soft edge of the light pool
  lux: number; // brightness on the surface at full power
  height: number; // distance between lamp and surface (the sheet is 2 units long)
  dim: number; // how far the rest of the studio dims at full power
  size: number; // size of the lamp itself: what you see mirrored in foil and varnish (a bulb, a softbox, a flame)
  glint: number; // brightness of that mirror image
};

export const LAMPS: Record<Exclude<LampKind, "off">, Spec> = {
  spot: { color: "#ffd8a6", angle: 0.3, penumbra: 0.55, lux: 2.6, height: 0.62, dim: 0.62, size: 0.1, glint: 26 }, // halogen spot, warm
  day: { color: "#fff5ea", angle: 0.62, penumbra: 0.95, lux: 1.9, height: 0.8, dim: 0.42, size: 0.42, glint: 7 }, // daylight, broad and soft
  led: { color: "#dde9ff", angle: 0.4, penumbra: 0.22, lux: 2.9, height: 0.6, dim: 0.62, size: 0.16, glint: 22 }, // cool LED, crisp edge
  candle: { color: "#ff9440", angle: 0.95, penumbra: 1, lux: 1.5, height: 0.42, dim: 0.78, size: 0.05, glint: 30 }, // flickers
  rainbow: { color: "#ffffff", angle: 0.36, penumbra: 0.6, lux: 2.6, height: 0.62, dim: 0.66, size: 0.14, glint: 22 }, // turns through the hues
};

/** a CSS colour for the lamp's swatch and the glow under the pointer */
export const lampCss = (k: LampKind) =>
  k === "off" ? "transparent" : k === "rainbow" ? "conic-gradient(#ff5a5a, #ffd23f, #5cff7a, #3fd8ff, #8a5cff, #ff5ad2, #ff5a5a)" : LAMPS[k].color;

export class PointerLamp {
  private light = new THREE.SpotLight("#ffffff", 0, 0, 0.3, 0.5, 2); // the light pool
  private face: THREE.RectAreaLight; // the lamp itself, so it shows up as a glint in foil and varnish
  private static ready = false;
  private ray = new THREE.Raycaster();
  private ndc: THREE.Vector2 | null = null;
  private pos = new THREE.Vector3();
  private aim = new THREE.Vector3();
  private placed = false;
  private last: Exclude<LampKind, "off"> = "spot";
  private active = 0; // fades in and out
  private glow: HTMLDivElement;
  private plane = new THREE.Plane();
  private tmp = new THREE.Vector3();
  private view = new THREE.Vector3();
  private normal = new THREE.Vector3();
  private off: () => void;

  constructor(scene: THREE.Scene, private el: HTMLElement, private settings: () => LampSettings) {
    this.light.castShadow = false;
    if (!PointerLamp.ready) { RectAreaLightUniformsLib.init(); PointerLamp.ready = true; }
    this.face = new THREE.RectAreaLight("#ffffff", 0, 1, 1);
    scene.add(this.light, this.light.target, this.face);
    if (process.env.NODE_ENV !== "production") (window as unknown as { __lamp?: PointerLamp }).__lamp = this;
    this.glow = document.createElement("div");
    this.glow.className = "lamp-glow";
    this.glow.setAttribute("aria-hidden", "true");
    el.appendChild(this.glow);
    const at = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("button,input,select")) { this.ndc = null; return; }
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      this.ndc = new THREE.Vector2((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1);
      this.glow.style.transform = `translate(${x}px, ${y}px)`;
    };
    const gone = (e: PointerEvent) => { if (e.type === "pointerleave" || e.pointerType !== "mouse") this.ndc = null; };
    el.addEventListener("pointermove", at);
    el.addEventListener("pointerdown", at);
    el.addEventListener("pointerup", gone);
    el.addEventListener("pointercancel", gone);
    el.addEventListener("pointerleave", gone);
    this.off = () => {
      el.removeEventListener("pointermove", at);
      el.removeEventListener("pointerdown", at);
      el.removeEventListener("pointerup", gone);
      el.removeEventListener("pointercancel", gone);
      el.removeEventListener("pointerleave", gone);
    };
  }

  /** once per frame; returns how far the studio around it should dim (0..1) */
  update(camera: THREE.Camera, target: THREE.Object3D, time: number): number {
    const s = this.settings();
    const on = s.kind !== "off" && s.power > 0 && this.ndc !== null;
    if (s.kind !== "off") this.last = s.kind;
    this.active += ((on ? 1 : 0) - this.active) * (on ? 0.14 : 0.08);
    const lit = s.kind !== "off" && this.ndc !== null;
    this.el.classList.toggle("lamp-on", lit);
    if (this.active < 0.003 && !on) {
      // kept in the scene at zero (switching a light off would rebuild every shader: a stutter)
      this.light.intensity = 0;
      this.face.intensity = 0;
      this.placed = false;
      this.glow.style.opacity = "0";
      return 0;
    }
    const spec = LAMPS[this.last];
    if (this.ndc) {
      this.ray.setFromCamera(this.ndc, camera);
      const hit = this.ray.intersectObject(target, true).find((h) => (h.object as THREE.Mesh).isMesh && h.object.visible);
      const p = this.tmp;
      if (hit) p.copy(hit.point);
      else {
        // beside the object: a plane through its middle, facing the camera
        camera.getWorldDirection(p);
        this.plane.setFromNormalAndCoplanarPoint(p.negate(), new THREE.Vector3());
        if (!this.ray.ray.intersectPlane(this.plane, p)) p.copy(this.ray.ray.origin).addScaledVector(this.ray.ray.direction, 3);
      }
      const k = this.placed ? 0.3 : 1;
      this.aim.lerp(p, k);
      // the lamp hangs at the mirror angle of the view: its reflection in foil and varnish lands right under the pointer
      const v = this.view.copy(this.ray.ray.direction).negate(); // towards the eye
      const n = this.normal;
      if (hit?.face) {
        n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
        if (n.dot(v) < 0) n.negate();
        // not quite a mirror: a little towards the eye, so a face seen at a grazing angle still gets light
        const dir = n.multiplyScalar(2 * n.dot(v)).sub(v).lerp(v, 0.08).normalize();
        p.addScaledVector(dir, spec.height);
      } else p.addScaledVector(v, spec.height);
      this.pos.lerp(p, k);
      this.placed = true;
    }
    let power = s.power;
    const L = this.light;
    if (this.last === "candle") {
      // a living flame: a few slow and fast waves, and the flame moves a little
      power *= 0.8 + 0.1 * Math.sin(time * 9.3) + 0.06 * Math.sin(time * 23.7 + 1.3) + 0.04 * Math.sin(time * 3.1);
      L.position.set(this.pos.x + 0.012 * Math.sin(time * 5.1), this.pos.y + 0.01 * Math.sin(time * 7.7), this.pos.z);
    } else L.position.copy(this.pos);
    if (this.last === "rainbow") L.color.setHSL((time * 0.09) % 1, 0.95, 0.62);
    else L.color.set(spec.color);
    L.angle = spec.angle;
    L.penumbra = spec.penumbra;
    // the same brightness on the surface whatever the lamp's height (the light falls off with the distance squared)
    L.intensity = spec.lux * power * this.active * spec.height * spec.height;
    L.target.position.copy(this.aim);
    L.target.updateMatrixWorld();
    const F = this.face;
    F.position.copy(L.position);
    F.lookAt(this.aim);
    F.width = F.height = spec.size;
    F.color.copy(L.color);
    F.intensity = spec.glint * power * this.active;
    if (this.last === "rainbow") this.glow.style.setProperty("--lamp", `hsl(${Math.round(((time * 0.09) % 1) * 360)} 95% 62%)`);
    else this.glow.style.setProperty("--lamp", spec.color);
    this.glow.style.opacity = String(Math.min(1, this.active * (0.35 + s.power)));
    return spec.dim * this.active * (0.35 + 0.65 * s.power);
  }

  dispose() {
    this.off();
    this.glow.remove();
    this.el.classList.remove("lamp-on");
    this.light.removeFromParent();
    this.light.target.removeFromParent();
    this.light.dispose();
    this.face.removeFromParent();
    this.face.dispose();
  }
}
