"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import gsap from "gsap";
import { FINISHES, LOOK, pageMaterial, studio, type FinishUniforms, type Look } from "./BrochureViewer";
import type { Fold } from "@/lib/pdf3d/fold";
import { Arrow } from "./Icons";

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
  back: { map: string; pbr: string } | null; // print on the back (the next PDF page), if any
  width: number; // image size in pixels
  height: number;
  fold: Fold;
  finish: string | null;
};

const THICK = 0.0016; // board thickness (front and back face apart)

export default function FoldViewer({ t, map, pbr, back, width, height, fold, finish }: Props) {
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
    scene.add(new THREE.HemisphereLight("#ffffff", "#3a3a40", 0.6));

    // the sheet: 2 units along its longest side, centred
    const S = 2 / Math.max(width, height);
    const cx = (width * S) / 2, cy = (height * S) / 2;
    const world = (x: number, y: number) => new THREE.Vector3(x * S - cx, cy - y * S, 0);

    const look: Look = { foil: { value: LOOK.foil }, paper: { value: LOOK.paper }, uv: { value: LOOK.uv }, ink: { value: LOOK.ink }, coat: { value: LOOK.coat } };
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
    const need = back ? 4 : 2;
    const frontMap = tex(map, true), frontPbr = tex(pbr, false);
    const backMap = back ? tex(back.map, true, true) : null, backPbr = back ? tex(back.pbr, false, true) : null;

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
    fold.panels.forEach((p, i) => {
      const g = new THREE.Group();
      const pivot = p.hinge ? world(p.hinge[0], p.hinge[1]) : new THREE.Vector3();
      pivots.push(pivot);
      if (p.hinge) {
        const b = world(p.hinge[2], p.hinge[3]);
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
      (p.parent >= 0 ? groups[p.parent] : root).add(g);
      groups.push(g);

      // the panel's shape: its mask (grid cells, rows top-down) as an alpha map over the panel's box
      const { w: mw, h: mh, data } = p.mask;
      // three.js reads an alpha map's green channel; rows bottom-up
      const rgba = new Uint8Array(mw * mh * 4);
      for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) rgba[((mh - 1 - y) * mw + x) * 4 + 1] = data[y * mw + x];
      const alpha = new THREE.DataTexture(rgba, mw, mh);
      alpha.magFilter = alpha.minFilter = THREE.LinearFilter;
      alpha.needsUpdate = true;
      textures.push(alpha);
      const [x0, y0, x1, y1] = p.box;
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
        geo.translate(-pivot.x, -pivot.y, 0);
        return geo;
      };
      const front = pageMaterial(frontMap, frontPbr, look, fu);
      front.alphaMap = alpha;
      front.alphaTest = 0.5;
      const backMat = back
        ? pageMaterial(backMap!, backPbr!, look, fu)
        : new THREE.MeshStandardMaterial({ color: "#e6e2d8", roughness: 0.92, metalness: 0 });
      backMat.alphaMap = alpha;
      backMat.alphaTest = 0.5;
      // the alpha map is read with the front's uv; on a mirrored back the print is mirrored, the shape is not
      for (const m of [front, backMat]) {
        m.polygonOffset = behind > 0;
        m.polygonOffsetFactor = behind;
        m.polygonOffsetUnits = behind * 4;
      }
      const mf = new THREE.Mesh(quad(THICK / 2, 1), front);
      const mb = new THREE.Mesh(quad(-THICK / 2, -1), backMat);
      for (const m of [mf, mb]) { m.castShadow = m.receiveShadow = true; g.add(m); meshes.push(m); }
      materials.push(front, backMat);
    });

    // the fold: deeper panels start a little later, so it folds in steps
    const maxDepth = Math.max(...fold.panels.map((p) => p.depth));
    const STEP = 0.35;
    const q = new THREE.Quaternion();
    const applyFold = (prog: number) => {
      const span = 1 + STEP * (maxDepth - 1);
      fold.panels.forEach((p, i) => {
        if (!p.hinge) return;
        const local = Math.min(1, Math.max(0, prog * span - STEP * (p.depth - 1)));
        const e = local * local * (3 - 2 * local);
        q.setFromAxisAngle(axes[i], signs[i] * p.angle * e);
        groups[i].quaternion.copy(q);
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
      window.clearInterval(startTimer);
      gsap.killTweensOf(state.current);
      gsap.killTweensOf(viewObj);
      ro.disconnect();
      io.disconnect();
      meshes.forEach((m) => m.geometry.dispose());
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
  }, [map, pbr, back, width, height, fold]);

  return (
    <div className="pdf3d-fold">
      <div ref={stage} className="brochure3d-stage" aria-label={t.drag}>
        {!ready && !failed && <p className="brochure3d-status">{t.loading}</p>}
        {failed && <p className="brochure3d-status">{t.noWebgl}</p>}
      </div>
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
      <p className="brochure3d-hint">{t.drag}</p>
    </div>
  );
}
