"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import gsap from "gsap";
import { EMBOSS_SCALE, FINISHES, LOOK, PDF_FOIL, pageMaterial, studio, type FinishUniforms, type Look } from "./BrochureViewer";
import type { Fold } from "@/lib/pdf3d/fold";
import { Arrow } from "./Icons";
import { PointerLamp, type LampSettings } from "./lamp";

/*
 * A die-cut sheet (packaging, a folder) in 3D that folds itself along its crease lines.
 * Every panel is a flat piece of the printed sheet (cut out with a mask), hung on its parent panel by the
 * crease between them (lib/pdf3d/fold.ts). Same studio, foil, SpotUV and finish as the 3D brochure.
 * Drag to turn it, the slider folds it.
 */

export type FoldText = { fold: string; flat: string; folded: string; play: string; drag: string; loading: string; noWebgl: string };

type Props = {
  t: FoldText;
  map: string; // print of the sheet
  pbr: string; // R SpotUV, G gold foil, B foil
  emboss?: string | null; // embossing as grey (white = raised), if any
  holo?: string | null; // holographic foil as grey, if any
  back: { map: string; pbr: string; emboss?: string | null; holo?: string | null } | null; // print on the back (the next PDF page), if any
  mm?: [number, number]; // the sheet's real size in millimetres
  width: number; // image size in pixels
  height: number;
  fold: Fold;
  finish: string | null;
  lamp?: LampSettings; // the pointer as a lamp (components/lamp.ts)
  controls?: HTMLElement | null; // where the fold button and slider go (the tool's top bar; null while it is not there yet); below the view without it
};

const BOARD_MM = 0.3; // board thickness
const BEND_MM = 2; // the width of board that bends round at a crease (a crease is a small curve, not a sharp edge)
const LAYERS = 2; // board-coloured layers between front and back, so a cut edge looks solid
const CORE_BEHIND = 8; // those layers lose the depth test to any face, so they only show where nothing covers them

export default function FoldViewer({ t, map, pbr, emboss, holo, back, mm, width, height, fold, finish, lamp, controls }: Props) {
  const lampRef = useRef<LampSettings>({ kind: "off", power: 0 });
  lampRef.current = lamp ?? { kind: "off", power: 0 };
  const stage = useRef<HTMLDivElement>(null);
  const state = useRef({ p: 0 }); // fold progress 0 (flat) .. 1 (folded)
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const finishU = useRef<FinishUniforms | null>(null);

  useEffect(() => {
    const u = finishU.current;
    if (!u) return;
    const f = FINISHES[finish ?? "none"] ?? FINISHES.none;
    (Object.keys(f) as (keyof typeof f)[]).forEach((k) => (u[k].value = f[k]));
  }, [finish]);

  // the user's view; the buttons also bring it back: flat = straight on, folded = from above at an angle
  const viewRef = useRef({ yaw: 0.55, pitch: -0.42, vy: 0, vp: 0 });
  const animateTo = (to: number) => {
    const d = 1.2 + 2.2 * Math.abs(to - state.current.p);
    gsap.killTweensOf(state.current);
    gsap.to(state.current, { p: to, duration: d, ease: "power1.inOut", onUpdate: () => setProgress(state.current.p) });
    const v = viewRef.current;
    v.vy = v.vp = 0;
    const yaw = to > 0.5 ? 0.55 : 0, turns = Math.round((v.yaw - yaw) / (2 * Math.PI)) * 2 * Math.PI;
    gsap.killTweensOf(v);
    gsap.to(v, { yaw: yaw + turns, pitch: to > 0.5 ? -0.42 : -0.12, duration: Math.min(d, 1.6), ease: "power2.inOut" });
  };

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const viewObj = viewRef.current;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch {
      setFailed(true);
      return;
    }
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const small = Math.min(screen.width, screen.height) < 700;
    renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 2 : 1.75));
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = "brochure3d-canvas";
    el.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#000000");
    scene.environment = studio(renderer);
    const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 60);
    const key = new THREE.SpotLight("#fff8ee", 7, 0, 0.7, 0.85, 1.6);
    key.castShadow = true;
    key.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.01;
    key.shadow.radius = 5;
    scene.add(key, key.target);
    const hemi = new THREE.HemisphereLight("#ffffff", "#3a3a40", 0.6);
    scene.add(hemi);
    const torch = new PointerLamp(scene, el, () => lampRef.current);

    // the sheet: 2 units along its longest side, centred
    const S = 2 / Math.max(width, height);
    const cx = (width * S) / 2, cy = (height * S) / 2;
    const world = (x: number, y: number) => new THREE.Vector3(x * S - cx, cy - y * S, 0);
    const uvOf = (v: THREE.Vector3) => [(v.x + cx) / (S * width), 1 - (cy - v.y) / (S * height)];
    // real size: the sheet is 2 units long, so 1 mm is 2 / (its longest side in mm)
    const unit = mm ? 2 / Math.max(mm[0], mm[1]) : 0.0016 / BOARD_MM;
    const THICK = BOARD_MM * unit, BEND = BEND_MM * unit;

    const look: Look = { foil: { value: LOOK.foil * PDF_FOIL }, paper: { value: LOOK.paper }, uv: { value: LOOK.uv }, ink: { value: LOOK.ink }, coat: { value: LOOK.coat } };
    const f0 = FINISHES[finish ?? "none"] ?? FINISHES.none;
    const fu: FinishUniforms = { coat: { value: f0.coat }, coatRough: { value: f0.coatRough }, foilRough: { value: f0.foilRough }, haze: { value: f0.haze } };
    finishU.current = fu;

    const loader = new THREE.TextureLoader();
    const aniso = renderer.capabilities.getMaxAnisotropy();
    const textures: THREE.Texture[] = [];
    const tex = (url: string, srgb: boolean, mirror = false) => {
      const tx = loader.load(url, () => { loaded++; if (loaded >= need) setReady(true); }, undefined, () => setFailed(true));
      if (srgb) tx.colorSpace = THREE.SRGBColorSpace;
      tx.anisotropy = aniso;
      if (mirror) { tx.wrapS = THREE.RepeatWrapping; tx.repeat.x = -1; tx.offset.x = 1; } // the back of a sheet is mirrored
      textures.push(tx);
      return tx;
    };
    let loaded = 0;
    let need = back ? 4 : 2;
    const frontMap = tex(map, true), frontPbr = tex(pbr, false);
    const backMap = back ? tex(back.map, true, true) : null, backPbr = back ? tex(back.pbr, false, true) : null;
    // embossing: raised on the front; on the back the same relief is pressed in (or the back page's own, if only it has one)
    const frontBump = emboss ? tex(emboss, false) : undefined;
    const backBump = frontBump ?? (back?.emboss ? tex(back.emboss, false, true) : undefined);
    if (frontBump) need++;
    if (!frontBump && backBump) need++;
    const frontHolo = holo ? tex(holo, false) : undefined;
    const backHolo = back?.holo ? tex(back.holo, false, true) : undefined;
    if (frontHolo) need++;
    if (backHolo) need++;
    // the board between the faces (seen at a cut edge)
    const boardColor = new THREE.Color("#e9e5da");

    // panels as nested groups: each turns about its crease, relative to its parent
    const root = new THREE.Group();
    const offset = new THREE.Group(); // keeps the folded object centred
    const turn = new THREE.Group(); // the user's rotation
    offset.add(root);
    turn.add(offset);
    scene.add(turn);
    const groups: THREE.Group[] = [];
    const pivots: THREE.Vector3[] = [];
    const axes: THREE.Vector3[] = [];
    const signs: number[] = [];
    const meshes: THREE.Mesh[] = [];
    const materials: THREE.Material[] = [];
    const bases: THREE.Vector3[] = []; // each group's position when flat
    // a hinge in sheet units: its line (from p0, along `along`, `len` long) and the direction to the child panel
    type Hinge = { p0: THREE.Vector3; along: THREE.Vector3; len: number; toChild: THREE.Vector3 };
    const hinges: (Hinge | null)[] = fold.panels.map((p) => {
      if (!p.hinge) return null;
      const p0 = world(p.hinge[0], p.hinge[1]), p1 = world(p.hinge[2], p.hinge[3]);
      const along = p1.clone().sub(p0);
      const len = along.length();
      along.normalize();
      const c = world(p.center[0], p.center[1]).sub(p0);
      const toChild = c.sub(along.clone().multiplyScalar(c.dot(along))).setZ(0).normalize();
      return { p0, along, len, toChild };
    });
    // the pivot lies on the outer board face for a box (the printed faces meet on the edge), in the middle for a folder
    const zPivots = fold.panels.map(() => (fold.packaging ? THICK / 2 : 0));
    fold.panels.forEach((p, i) => {
      const g = new THREE.Group();
      const pivot = p.hinge ? world(p.hinge[0], p.hinge[1]) : new THREE.Vector3();
      if (p.hinge) pivot.z = zPivots[i];
      pivots.push(pivot);
      if (p.hinge) {
        const b = world(p.hinge[2], p.hinge[3]).setZ(pivot.z);
        const axis = b.clone().sub(pivot).normalize();
        axes.push(axis);
        // fold away from the viewer (behind the sheet), so the print ends up outside
        const c = world(p.center[0], p.center[1]).sub(pivot);
        signs.push(new THREE.Vector3().crossVectors(axis, c).z > 0 ? -1 : 1);
      } else {
        axes.push(new THREE.Vector3(1, 0, 0));
        signs.push(0);
      }
      g.position.copy(pivot).sub(p.parent >= 0 ? pivots[p.parent] : new THREE.Vector3());
      bases.push(g.position.clone());
      (p.parent >= 0 ? groups[p.parent] : root).add(g);
      groups.push(g);

      // the panel's shape: its mask (grid cells, rows top-down) as an alpha map over the panel's box
      const { w: mw, h: mh, data } = p.mask;
      const [x0, y0, x1, y1] = p.box;
      // the board along each of its creases (its own and its children's) bends round: that strip is drawn by the bend,
      // so the flat panel stops half a bend width before the crease
      const own = fold.panels.map((q, k) => (k === i || q.parent === i) && q.hinge ? q.hinge : null).filter((h): h is NonNullable<typeof h> => !!h);
      const cw = (x1 - x0) / mw, ch = (y1 - y0) / mh;
      // in image pixels; one mask cell less, so panel and bend overlap a little and no slit shows between them
      const half = Math.max(0, BEND / 2 / S - 1.2 * Math.max(cw, ch));
      const near = (x: number, y: number) => own.some(([ax, ay, bx, by]) => {
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
        const t = L2 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0;
        if (t < 0 || t > 1) return false;
        return Math.hypot(ax + t * dx - x, ay + t * dy - y) < half;
      });
      // three.js reads an alpha map's green channel; rows bottom-up
      const rgba = new Uint8Array(mw * mh * 4);
      for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
        if (!data[y * mw + x] || near(x0 + (x + 0.5) * cw, y0 + (y + 0.5) * ch)) continue;
        rgba[((mh - 1 - y) * mw + x) * 4 + 1] = 255;
      }
      const alpha = new THREE.DataTexture(rgba, mw, mh);
      alpha.magFilter = alpha.minFilter = THREE.LinearFilter;
      alpha.needsUpdate = true;
      textures.push(alpha);
      const u0 = x0 / width, u1 = x1 / width, v0 = 1 - y1 / height, v1 = 1 - y0 / height;
      // the alpha map uses the same uv as the print: map the panel box onto 0..1
      alpha.repeat.set(1 / (u1 - u0), 1 / (v1 - v0));
      alpha.offset.set(-u0 / (u1 - u0), -v0 / (v1 - v0));

      // panels that end up in the same plane (a lid over its dust flaps, a wall over a tuck or glue flap) would
      // flicker: smaller panels lose the depth test a little, without moving any geometry, so the box closes exactly
      const behind = p.parent < 0 ? 0 : 1 + 6 * (1 - Math.min(1, p.area / fold.panels[0].area));
      const quad = (z: number, facing: 1 | -1) => {
        const a = world(x0, y1), b = world(x1, y0);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute([a.x, a.y, z, b.x, a.y, z, b.x, b.y, z, a.x, b.y, z], 3));
        geo.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, facing, 0, 0, facing, 0, 0, facing, 0, 0, facing], 3));
        geo.setAttribute("uv", new THREE.Float32BufferAttribute([u0, v0, u1, v0, u1, v1, u0, v1], 2));
        geo.setAttribute("aSpine", new THREE.Float32BufferAttribute([1, 1, 1, 1], 1)); // no spine shading on a flat sheet
        geo.setIndex(facing === 1 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
        geo.translate(-pivot.x, -pivot.y, -pivot.z);
        return geo;
      };
      const front = pageMaterial(frontMap, frontPbr, look, fu, frontBump, frontHolo);
      front.alphaMap = alpha;
      front.alphaTest = 0.5;
      const backMat = back
        ? pageMaterial(backMap!, backPbr!, look, fu, backBump, backHolo)
        : new THREE.MeshStandardMaterial({ color: "#e6e2d8", roughness: 0.92, metalness: 0, bumpMap: backBump ?? null });
      if (backBump) backMat.bumpScale = frontBump ? -EMBOSS_SCALE : EMBOSS_SCALE;
      backMat.alphaMap = alpha;
      backMat.alphaTest = 0.5;
      // the board inside, seen at a cut edge
      const core = new THREE.MeshStandardMaterial({ color: boardColor, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, alphaMap: alpha, alphaTest: 0.5 });
      // the alpha map is read with the front's uv; on a mirrored back the print is mirrored, the shape is not
      for (const m of [front, backMat, core]) {
        const d = m === core ? behind + CORE_BEHIND : behind;
        m.polygonOffset = d > 0;
        m.polygonOffsetFactor = d;
        m.polygonOffsetUnits = d * 4;
      }
      const mf = new THREE.Mesh(quad(THICK / 2, 1), front);
      const mb = new THREE.Mesh(quad(-THICK / 2, -1), backMat);
      for (const m of [mf, mb]) { m.castShadow = m.receiveShadow = true; g.add(m); meshes.push(m); }
      for (let k = 1; k <= LAYERS; k++) {
        const mc = new THREE.Mesh(quad(THICK * (k / (LAYERS + 1) - 0.5), 1), core);
        mc.receiveShadow = true;
        g.add(mc);
        meshes.push(mc);
      }
      materials.push(front, backMat, core);
    });

    // the bends: at every crease a narrow strip of board curves round (an arc), front and back face plus the edges
    const SEG = 10;
    const stripMeshes: THREE.Mesh[] = [];
    const bends = fold.panels.map((p, i) => {
      const h = hinges[i];
      if (!h) return null;
      const stripFront = pageMaterial(frontMap, frontPbr, look, fu, frontBump, frontHolo);
      const stripBack = back
        ? pageMaterial(backMap!, backPbr!, look, fu, backBump, backHolo)
        : new THREE.MeshStandardMaterial({ color: "#e6e2d8", roughness: 0.92, metalness: 0, bumpMap: backBump ?? null });
      if (backBump) stripBack.bumpScale = frontBump ? -EMBOSS_SCALE : EMBOSS_SCALE;
      const stripCore = new THREE.MeshStandardMaterial({ color: boardColor, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
      // the bend gives way in depth like its panel does (a closing flap's bend stays behind the wall it lies in);
      // the board inside gives way more, so it only shows at a real cut edge
      const behind = 1 + 6 * (1 - Math.min(1, p.area / fold.panels[0].area));
      for (const m of [stripFront, stripBack, stripCore]) {
        const d = m === stripCore ? behind + CORE_BEHIND : behind;
        m.polygonOffset = true;
        m.polygonOffsetFactor = d;
        m.polygonOffsetUnits = d * 4;
      }
      materials.push(stripFront, stripBack, stripCore);
      const parentPivot = p.parent >= 0 ? pivots[p.parent] : new THREE.Vector3();
      const make = (mat: THREE.Material, facing: 1 | -1, n: number) => {
        // n = vertices across the strip (SEG + 1) by 2 along the crease
        const pos = new Float32Array(n * 2 * 3), nor = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2);
        const idx: number[] = [];
        // which way the triangles face depends on the crease's direction
        const up = new THREE.Vector3().crossVectors(h.toChild, h.along).z > 0 ? 1 : -1;
        for (let k = 0; k < n - 1; k++) {
          const a = k * 2, b = a + 1, c = a + 2, d = a + 3;
          if (facing * up === 1) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
        geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
        geo.setAttribute("aSpine", new THREE.Float32BufferAttribute(new Array(n * 2).fill(1), 1));
        geo.setIndex(idx);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;
        mesh.castShadow = mesh.receiveShadow = true;
        (p.parent >= 0 ? groups[p.parent] : root).add(mesh);
        stripMeshes.push(mesh);
        return mesh;
      };
      const faces = [make(stripFront, 1, SEG + 1), make(stripBack, -1, SEG + 1)];
      const cores = Array.from({ length: LAYERS }, () => make(stripCore, 1, SEG + 1));
      return { h, parentPivot, faces, cores };
    });
    const P = new THREE.Vector3(), N = new THREE.Vector3(), Q = new THREE.Vector3();
    /*
     * The bend at panel i's crease when it has turned theta: the point (P) and normal (N) of the
     * board at u (0..1 across the bend), at the pivot height. Returns how far past the crease the panel starts.
     * A box: the bend is a round corner inside the sharp one, so every wall stays exactly in its plane and the box closes.
     * A folder (folded nearly flat): the bend rolls the board round, like a spine.
     */
    const arcAt = (i: number, theta: number, u: number) => {
      const h = hinges[i]!;
      P.copy(h.p0).setZ(zPivots[i]);
      if (theta < 1e-4) { P.addScaledVector(h.toChild, -BEND / 2 + u * BEND); N.set(0, 0, 1); return BEND / 2; }
      // a box: the corner is rounded from half a bend before the crease to half a bend after it (where the flat panels
      // stop), so every panel keeps its exact place; a folder: the board rolls round over the bend's width
      const r = fold.packaging ? BEND / 2 / Math.tan(theta / 2) : BEND / theta, phi = u * theta;
      const t = BEND / 2; // where the arc starts, before the crease
      P.addScaledVector(h.toChild, -t + r * Math.sin(phi)).setZ(P.z - r * (1 - Math.cos(phi)));
      N.copy(h.toChild).multiplyScalar(Math.sin(phi)).setZ(Math.cos(phi));
      return t;
    };
    const setBend = (i: number, theta: number) => {
      const b = bends[i];
      if (!b) return;
      const { h, parentPivot } = b;
      const layers: [THREE.Mesh, number][] = [[b.faces[0], THICK / 2], [b.faces[1], -THICK / 2], ...b.cores.map((m, k): [THREE.Mesh, number] => [m, THICK * ((k + 1) / (LAYERS + 1) - 0.5)])];
      for (const [mesh, z] of layers) {
        const g = mesh.geometry;
        const pos = g.attributes.position.array as Float32Array, nor = g.attributes.normal.array as Float32Array, uv = g.attributes.uv.array as Float32Array;
        const facing = mesh === b.faces[1] ? -1 : 1;
        for (let k = 0; k <= SEG; k++) {
          const u = k / SEG;
          arcAt(i, theta, u);
          // the face lies `z` from the mid-plane; the arc runs at the pivot height
          Q.copy(P).addScaledVector(N, z - zPivots[i]).sub(parentPivot);
          // its print: where this point lies on the flat sheet
          const flat = h.p0.clone().addScaledVector(h.toChild, -BEND / 2 + u * BEND);
          for (let e = 0; e < 2; e++) {
            const j = k * 2 + e;
            const off = e * h.len;
            pos[j * 3] = Q.x + h.along.x * off; pos[j * 3 + 1] = Q.y + h.along.y * off; pos[j * 3 + 2] = Q.z;
            nor[j * 3] = N.x * facing; nor[j * 3 + 1] = N.y * facing; nor[j * 3 + 2] = N.z * facing;
            const [tu, tv] = uvOf(flat.clone().addScaledVector(h.along, off));
            uv[j * 2] = tu; uv[j * 2 + 1] = tv;
          }
        }
        g.attributes.position.needsUpdate = true;
        g.attributes.normal.needsUpdate = true;
        g.attributes.uv.needsUpdate = true;
      }
    };

    // the fold: deeper panels start a little later, so it folds in steps
    const maxDepth = Math.max(...fold.panels.map((p) => p.depth));
    const STEP = 0.35;
    const q = new THREE.Quaternion();
    const tip = new THREE.Vector3();
    const applyFold = (prog: number) => {
      const span = 1 + STEP * (maxDepth - 1);
      fold.panels.forEach((p, i) => {
        const h = hinges[i];
        if (!p.hinge || !h) return;
        const local = Math.min(1, Math.max(0, prog * span - STEP * (p.depth - 1)));
        const e = local * local * (3 - 2 * local);
        const theta = p.angle * e;
        q.setFromAxisAngle(axes[i], signs[i] * theta);
        groups[i].quaternion.copy(q);
        // the panel starts where the bend ends: the point half a bend past the crease goes to the end of the arc
        arcAt(i, theta, 1);
        tip.copy(h.toChild).multiplyScalar(BEND / 2).applyQuaternion(q);
        groups[i].position.copy(bases[i]).add(P.sub(pivots[i]).sub(tip));
        setBend(i, theta);
      });
    };

    // camera: keep the whole object in view, centred
    const box = new THREE.Box3();
    const corner = new THREE.Vector3();
    const inv = new THREE.Matrix4();
    const m4 = new THREE.Matrix4();
    const center = new THREE.Vector3();
    let radius = 1.5, camDist = 0;
    const corners = Array.from({ length: 8 }, () => new THREE.Vector3());
    const ndc = new THREE.Vector3();
    const measure = () => {
      offset.updateMatrixWorld(true);
      inv.copy(offset.matrixWorld).invert();
      box.makeEmpty();
      for (const m of meshes) {
        const g = m.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        m4.multiplyMatrices(inv, m.matrixWorld);
        const bb = g.boundingBox!;
        for (let k = 0; k < 8; k++) {
          corner.set(k & 1 ? bb.max.x : bb.min.x, k & 2 ? bb.max.y : bb.min.y, k & 4 ? bb.max.z : bb.min.z).applyMatrix4(m4);
          box.expandByPoint(corner);
        }
      }
      box.getCenter(center);
      radius = box.getSize(corner).length() / 2;
    };

    const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.16, 0.2, 3));
    composer.addPass(new OutputPass());
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    // drag turns the object (with a little inertia); the pointer moves the light
    const view = viewObj;
    const light = { x: 0, y: 0, tx: 0, ty: 0 };
    let drag: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("button,input")) return;
      drag = { x: e.clientX, y: e.clientY };
      gsap.killTweensOf(view);
      view.vy = view.vp = 0;
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      light.tx = (e.clientX - r.left) / r.width - 0.5;
      light.ty = (e.clientY - r.top) / r.height - 0.5;
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag = { x: e.clientX, y: e.clientY };
      view.vy = (dx / r.width) * 4;
      view.vp = (dy / r.height) * 3;
      view.yaw += view.vy;
      view.pitch = Math.max(-1.4, Math.min(1.4, view.pitch + view.vp));
    };
    const up = () => { drag = null; };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);

    let visible = true;
    const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; });
    io.observe(el);
    const clock = new THREE.Clock();
    let raf = 0;
    let started = false;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) return;
      const time = clock.getElapsedTime();
      if (!drag) {
        view.yaw += view.vy;
        view.pitch = Math.max(-1.4, Math.min(1.4, view.pitch + view.vp));
        view.vy *= 0.92;
        view.vp *= 0.92;
      }
      turn.rotation.set(view.pitch, view.yaw, 0, "YXZ");
      light.x += (light.tx + (reduce ? 0 : 0.05 * Math.sin(time * 0.5)) - light.x) * 0.08;
      light.y += (light.ty - light.y) * 0.08;
      scene.environmentRotation.set(light.y * 0.9, -light.x * 1.6, 0);
      key.position.set(-1.6 + light.x * 3, 2.6 - light.y * 2.5, 3.6);
      const dim = torch.update(camera, turn, time);
      key.intensity = 7 * (1 - dim);
      hemi.intensity = 0.6 * (1 - dim);
      scene.environmentIntensity = Math.max(0.25, 1 - dim * 1.3);

      applyFold(state.current.p);
      measure();
      offset.position.lerp(center.clone().negate(), camDist === 0 ? 1 : 0.1);
      // as close as possible with every corner of the object inside the frame (as the brochure does)
      turn.updateMatrixWorld(true);
      for (let k = 0; k < 8; k++) {
        corners[k].set(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).sub(center).applyMatrix4(turn.matrixWorld);
      }
      let lo = 0.3, hi = Math.max(2, radius * 8);
      for (let k = 0; k < 16; k++) {
        const mid = (lo + hi) / 2;
        camera.position.set(0, 0, mid);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        if (corners.every((c) => { ndc.copy(c).project(camera); return Math.abs(ndc.x) < 0.9 && Math.abs(ndc.y) < 0.86 && ndc.z < 1; })) hi = mid;
        else lo = mid;
      }
      const target = hi;
      camDist = camDist === 0 ? target : camDist + (target - camDist) * (target > camDist ? 0.2 : 0.05);
      camera.position.set(0, 0, camDist);
      camera.lookAt(0, 0, 0);
      // local development only: window.__foldZoom = { z: 0.15, x: 0.2, y: 0.3 } looks closely at one spot
      if (process.env.NODE_ENV !== "production") {
        const dz = (window as unknown as { __foldZoom?: { z: number; x: number; y: number } }).__foldZoom;
        if (dz) { camera.lookAt(dz.x, dz.y, 0); camera.zoom = 1 / dz.z; camera.updateProjectionMatrix(); }
        else if (camera.zoom !== 1) { camera.zoom = 1; camera.updateProjectionMatrix(); }
      }
      composer.render();
    };
    frame();

    // fold once by itself, after the textures arrive
    const startTimer = window.setInterval(() => {
      if (started || loaded < need) return;
      started = true;
      window.clearInterval(startTimer);
      if (!reduce) window.setTimeout(() => animateTo(1), 600);
      else { state.current.p = 1; setProgress(1); }
    }, 100);

    return () => {
      cancelAnimationFrame(raf);
      torch.dispose();
      window.clearInterval(startTimer);
      gsap.killTweensOf(state.current);
      gsap.killTweensOf(viewObj);
      ro.disconnect();
      io.disconnect();
      meshes.forEach((m) => m.geometry.dispose());
      stripMeshes.forEach((m) => m.geometry.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((x) => x.dispose());
      scene.environment?.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      finishU.current = null;
    };
    // built once per sheet; the finish goes through its uniforms
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pbr, emboss, holo, back, mm, width, height, fold]);

  const bar = (
    <div className="pdf3d-foldbar">
      <button type="button" className="btn primary" onMouseDown={(e) => e.preventDefault()} onClick={() => animateTo(progress > 0.5 ? 0 : 1)}>
        {progress > 0.5 ? t.flat : t.folded}
        <span className="arr"><Arrow /></span>
      </button>
      <label className="pdf3d-slider" style={{ ["--p" as string]: `${Math.round(progress * 100)}%` }}>
        <span>{t.fold}</span>
        <input
          type="range" min={0} max={100} value={Math.round(progress * 100)}
          onChange={(e) => { gsap.killTweensOf(state.current); state.current.p = Number(e.target.value) / 100; setProgress(state.current.p); }}
        />
      </label>
    </div>
  );

  return (
    <div className="pdf3d-fold">
      <div ref={stage} className="brochure3d-stage" aria-label={t.drag}>
        {!ready && !failed && <p className="brochure3d-status">{t.loading}</p>}
        {failed && <p className="brochure3d-status">{t.noWebgl}</p>}
      </div>
      {controls === undefined ? bar : controls && createPortal(bar, controls)}
      <p className="brochure3d-hint">{t.drag}</p>
    </div>
  );
}
