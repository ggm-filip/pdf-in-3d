"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import gsap from "gsap";
import { Arrow } from "./Icons";
import { tune as live, tf } from "./tuning";
import { PointerLamp, type LampSettings } from "./lamp";

/*
 * 3D brochure: real pages you can leaf through, with the cold foil and SpotUV from the press files.
 *
 * Textures come from scripts/brochure-3d.py: per page the CMYK print (p<n>.webp) and a map (p<n>-pbr.webp)
 * with R = SpotUV, G = gold foil, B = all foil. three.js renders them physically: the foil is a metal tinted
 * by the CMYK printed on it (yellow on silver = gold), gold foil is gold, the SpotUV a clear gloss layer on top.
 * Only the textures of the pages near the open spread are loaded, so a thick brochure stays light on phones.
 * The light comes from a studio environment that turns with the pointer (or the phone's tilt), and a page
 * that bends while it turns sweeps the reflections across the foil.
 */

/**
 * Where the pages come from. Without a source the viewer shows our own brochure (public/brochure-3d/);
 * the PDF-in-3D tool passes the pages of an uploaded PDF (blob URLs).
 */
export type BrochureSource = {
  pages: number;
  aspect: number; // page height / width
  map: (p: number, small: boolean) => string | null; // the print of page p (1-based)
  pbr: (p: number, small: boolean) => string | null; // R SpotUV, G gold foil, B foil
  emboss?: (p: number, small: boolean) => string | null; // the embossing as grey (white = raised), if any
  holo?: (p: number, small: boolean) => string | null; // the holographic foil as grey, if any
  finishes: (string | null)[]; // finish per page (index 0 = page 1)
};

const OWN: Omit<BrochureSource, "finishes"> = {
  pages: 24,
  aspect: 2048 / 1449,
  map: (p, small) => `/brochure-3d/${small ? 1024 : 2048}/p${p}.webp`,
  pbr: (p, small) => `/brochure-3d/${small ? 1024 : 2048}/p${p}-pbr.webp`,
};

export type BrochureText = {
  prev: string;
  next: string;
  page: string;
  hint: string;
  tilt: string;
  loading: string;
  noWebgl: string;
};

const W = 1; // page width; the height follows the page (source.aspect)
const COLS = 56;
const ROWS = 10;
const GAP = 0.0006; // tiny distance between the top sheets, the same on both sides, so the spread lies level and no edge peeks out

/* a bright studio for the metal to reflect: dark room, soft boxes, a warm and a cool strip */
export function studio(renderer: THREE.WebGLRenderer) {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",
      fragmentShader: "varying vec3 vP; void main(){ float y = normalize(vP).y; gl_FragColor = vec4(mix(vec3(.035,.035,.04), vec3(.16,.16,.18), smoothstep(-.4,.9,y)), 1.); }",
    }),
  );
  env.add(room);
  const box = (w: number, h: number, color: string, intensity: number, pos: [number, number, number]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  box(5, 2.4, "#ffffff", 3.4, [0, 6, 5]); // big soft box above, in front
  box(1, 7, "#fff1dc", 6, [-6, 1, 3]); // warm strip left
  box(1, 7, "#dfeaff", 5, [6, 1, 3]); // cool strip right
  box(0.8, 0.8, "#ffffff", 12, [2.5, 3, 7]); // small hot light: the sharp glint
  box(8, 1, "#ffffff", 2.5, [0, -4, 6]); // faint bounce from below
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.015).texture;
  pmrem.dispose();
  return tex;
}

/* front + back of one sheet; positions are bent every frame on the CPU */
function sheetGeometry() {
  const g = new THREE.BufferGeometry();
  const n = (COLS + 1) * (ROWS + 1);
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const spine = new Float32Array(n * 2);
  const idx: number[] = [];
  for (let side = 0; side < 2; side++) {
    for (let r = 0; r <= ROWS; r++) {
      for (let c = 0; c <= COLS; c++) {
        const i = side * n + r * (COLS + 1) + c;
        const u = c / COLS;
        uv[i * 2] = side === 0 ? u : 1 - u;
        uv[i * 2 + 1] = r / ROWS;
        spine[i] = u;
      }
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const a = side * n + r * (COLS + 1) + c, b = a + 1, d = a + COLS + 1, e = d + 1;
        if (side === 0) idx.push(a, b, d, b, e, d);
        else idx.push(a, d, b, b, d, e);
      }
    }
  }
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("aSpine", new THREE.BufferAttribute(spine, 1));
  g.setIndex(idx);
  g.addGroup(0, ROWS * COLS * 6, 0);
  g.addGroup(ROWS * COLS * 6, ROWS * COLS * 6, 1);
  return g;
}

/*
 * Bend a sheet. t = 0 lies on the right, t = 1 on the left. The edge lags behind the spine while turning
 * (lag > 0 when turning forward), and `twist` lets the grabbed corner lead.
 */
function bend(g: THREE.BufferGeometry, H: number, t: number, lag: number, twist: number, z0: number) {
  const pos = g.attributes.position.array as Float32Array;
  const nor = g.attributes.normal.array as Float32Array;
  const n = (COLS + 1) * (ROWS + 1);
  const theta = t * Math.PI;
  const lift = Math.sin(Math.PI * t);
  const ds = W / COLS;
  for (let r = 0; r <= ROWS; r++) {
    const y = (r / ROWS - 0.5) * H;
    const tw = twist * (r / ROWS - 0.5) * lift;
    let x = 0, z = z0;
    for (let c = 0; c <= COLS; c++) {
      const s = c / COLS;
      const a = Math.min(Math.PI, Math.max(0, theta - lift * (lag * 1.9 + tw) * Math.pow(s, 1.3)));
      const ca = Math.cos(a), sa = Math.sin(a);
      if (c > 0) { x += ca * ds; z += sa * ds; }
      const i = r * (COLS + 1) + c, j = n + i;
      pos[i * 3] = pos[j * 3] = x;
      pos[i * 3 + 1] = pos[j * 3 + 1] = y;
      pos[i * 3 + 2] = z + 0.0004;
      pos[j * 3 + 2] = z - 0.0004;
      nor[i * 3] = -sa; nor[i * 3 + 1] = 0; nor[i * 3 + 2] = ca;
      nor[j * 3] = sa; nor[j * 3 + 1] = 0; nor[j * 3 + 2] = -ca;
    }
  }
  g.attributes.position.needsUpdate = true;
  g.attributes.normal.needsUpdate = true;
  g.computeBoundingSphere();
}

/* paper, foil and SpotUV in one physical material */
/* the look: foil = how much the foil reflects, paper = how bright the print looks, uv = SpotUV gloss */
// soft: extra blur on the foil reflection (added to its roughness); holo: how strongly holographic foil colours
export type Look = { foil: { value: number }; paper: { value: number }; uv: { value: number }; ink: { value: number }; coat: { value: number }; soft?: { value: number }; holo?: { value: number } };
// foil and paper: the owner's choice in the settings panel (foil 70%, brightness 115%, 26.11.2026)
// the owner's choice in the settings panel (26.11.2026): foil 160%, CMYK on foil 45%, brightness 80%, SpotUV 95%, finish 145% of the previous values
export const LOOK = { foil: 1.104, paper: 1.056, uv: 3.09, ink: 0.36, coat: 1.45 };
// the PDF-in-3D tool: foil glossier than in the brochure (the owner's wish, 26.11.2026 and again 27.11.2026),
// then 10% less and with a softer, blurred reflection edge (27.11.2026: 1.4 → 1.26, see tuning.ts "soft")
export const PDF_FOIL = 1.26;

/*
 * The finish over the whole page, from the marker on each page (scripts/brochure-3d.py → finishes.json).
 * coat: how much of a clear layer lies over the page, coatRough: how glossy it is,
 * foilRough: how sharp the foil still reflects through it, haze: the slight milkiness of a matt film.
 */
type Finish = { coat: number; coatRough: number; foilRough: number; haze: number };
export const FINISHES: Record<string, Finish> = {
  none: { coat: 0, coatRough: 0.1, foilRough: 0.16, haze: 0 },
  "gloss-varnish": { coat: 0.35, coatRough: 0.12, foilRough: 0.16, haze: 0 },
  "matt-varnish": { coat: 0.25, coatRough: 0.6, foilRough: 0.27, haze: 0.015 },
  "gloss-laminated": { coat: 0.8, coatRough: 0.06, foilRough: 0.15, haze: 0 },
  "matt-laminated": { coat: 0.45, coatRough: 0.7, foilRough: 0.36, haze: 0.03 },
};

export type FinishUniforms = { [K in keyof Finish]: { value: number } };

/** how high an embossing (preeg, about 0.4 mm) looks in the light */
export const EMBOSS_SCALE = 2.2;

/*
 * The order of the layers, as on the press and after it: foil, then CMYK and Pantone, then varnish, then the laminate,
 * and last the external finishes (SpotUV, embossing). So the laminate dulls the foil and the print under it,
 * but a SpotUV lies on top of it and always shines just as hard; an embossing lifts everything, print and all.
 */
/** sets (or swaps) the holographic foil mask of a page material made with a `holo` texture */
export function setHolo(m: THREE.Material, tx: THREE.Texture) {
  const u = m.userData as { holo?: { value: THREE.Texture }; holoM?: { value: THREE.Matrix3 } };
  if (!u.holo || !u.holoM) return;
  tx.updateMatrix();
  u.holo.value = tx;
  u.holoM.value.copy(tx.matrix);
}

export function pageMaterial(map: THREE.Texture, pbr: THREE.Texture, look: Look, finish: FinishUniforms, bump?: THREE.Texture, holo?: THREE.Texture) {
  const m = new THREE.MeshPhysicalMaterial({
    map,
    roughnessMap: pbr,
    metalnessMap: pbr,
    clearcoatMap: pbr,
    roughness: 1,
    metalness: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.035,
    specularIntensity: 0.25, // paper: only a faint sheen (does not affect the foil)
    envMapIntensity: 1,
  });
  if (bump) { m.bumpMap = bump; m.bumpScale = EMBOSS_SCALE; }
  // holographic foil: a rainbow that moves with the light and the viewing angle
  const holoU = { holo: { value: holo ?? null }, holoM: { value: new THREE.Matrix3() } };
  if (holo) { const d = m as unknown as { defines?: Record<string, string> }; d.defines = { ...d.defines, USE_HOLO: "" }; m.userData.holo = holoU.holo; m.userData.holoM = holoU.holoM; setHolo(m, holo); }
  m.onBeforeCompile = (s) => {
    s.uniforms.uHolo = holoU.holo;
    s.uniforms.uHoloM = holoU.holoM;
    s.uniforms.uUvBoost = look.uv;
    s.uniforms.uFoilGain = look.foil;
    s.uniforms.uPaperGain = look.paper;
    s.uniforms.uInkLift = look.ink;
    s.uniforms.uCoatGain = look.coat;
    s.uniforms.uCoat = finish.coat;
    s.uniforms.uCoatRough = finish.coatRough;
    s.uniforms.uFoilRough = finish.foilRough;
    s.uniforms.uHaze = finish.haze;
    s.uniforms.uFoilSoft = look.soft ?? { value: 0 };
    s.uniforms.uHoloMix = look.holo ?? { value: 0.55 };
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aSpine; varying float vSpine; varying vec2 vPageUv;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSpine = aSpine; vPageUv = uv;");
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uUvBoost, uFoilGain, uPaperGain, uInkLift, uCoatGain, uCoat, uCoatRough, uFoilRough, uHaze, uFoilSoft, uHoloMix; float bUvMask; varying float vSpine; varying vec2 vPageUv;
#ifdef USE_HOLO
uniform sampler2D uHolo; uniform mat3 uHoloM;
#endif
float bHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(bHash(i), bHash(i+vec2(1,0)), f.x), mix(bHash(i+vec2(0,1)), bHash(i+vec2(1,1)), f.x), f.y); }`,
      )
      // the fold: paper darkens a little towards the spine
      .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb *= mix(.7, 1., smoothstep(0., .09, vSpine));")
      // paper is matte, foil nearly a mirror that reflects a bit less than a perfect one; gold foil is gold
      .replace(
        "#include <metalnessmap_fragment>",
        `#include <metalnessmap_fragment>
roughnessFactor = mix(.82, min(1., uFoilRough + uFoilSoft), metalnessFactor);
// CMYK on foil: the ink also shows its own colour (like ink on paper), so it stays bright when the foil shines less;
// bare foil (no ink) stays pure metal
{ vec3 c = diffuseColor.rgb; float ink = 1. - min(c.r, min(c.g, c.b));
  metalnessFactor *= 1. - uInkLift * smoothstep(0., .6, ink); }
diffuseColor.rgb *= mix(vec3(1.), vec3(1., .72, .33), texture2D(roughnessMap, vRoughnessMapUv).g);
diffuseColor.rgb *= mix(uPaperGain, uFoilGain, metalnessFactor);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.), uHaze * uCoatGain);`,
      )
      // foil on paper is never perfectly flat: a gentle waviness bends the reflections a little
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
{ float fm = texture2D(roughnessMap, vRoughnessMapUv).b;
  vec2 w = vec2(bNoise(vPageUv * vec2(4., 5.6)), bNoise(vPageUv * vec2(5., 3.5) + 9.)) - .5;
  normal = normalize(normal + fm * vec3(w * .09, 0.)); }
#ifdef USE_HOLO
// holographic foil: the colour of the metal runs through the rainbow with the angle to the viewer and across the
// foil (fine bands), so it changes colour as the sheet turns
{ float hm = texture2D(uHolo, (uHoloM * vec3(vPageUv, 1.)).xy).r;
  if (hm > .002) {
    vec3 V = normalize(vViewPosition);
    float h = dot(normal, V) * 2.6 + V.x * 1.8 + V.y * 1.2 + dot(vPageUv, vec2(2.4, 1.6)) + bNoise(vPageUv * 220.) * .06;
    vec3 rb = clamp(abs(mod(h * 6. + vec3(0., 4., 2.), 6.) - 3.) - 1., 0., 1.);
    diffuseColor.rgb *= mix(vec3(1.), mix(vec3(1.), rb, uHoloMix) * 1.1, hm);
  }
}
#endif`,
      )
      // SpotUV: a thick, hard gloss, stronger than a thin varnish layer would give
      .replace(
        "( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;",
        "( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat * mix(1., uUvBoost, bUvMask);",
      )
      .replace("material.clearcoatF0 = vec3( 0.04 );", "material.clearcoatF0 = vec3( 0.06 );")
      // varnish or laminate over the whole page; the SpotUV stays the hardest gloss on top of it
      .replace(
        "material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );",
        `material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
bUvMask = material.clearcoat;
material.clearcoat = mix(uCoat * uCoatGain, 1., bUvMask); // SpotUV: the same gloss over any laminate
material.clearcoatRoughness = mix(uCoatRough, material.clearcoatRoughness, bUvMask);`,
      );
  };
  return m;
}

// controls: where the page buttons go (a tool's top bar; null while it is not there yet); below the book without it
export default function BrochureViewer({ t, source, bare, lamp, controls }: { t: BrochureText; source?: BrochureSource; bare?: boolean; lamp?: LampSettings; controls?: HTMLElement | null }) {
  const lampRef = useRef<LampSettings>({ kind: "off", power: 0 });
  lampRef.current = lamp ?? { kind: "off", power: 0 };
  const src = source ?? OWN;
  const PAGES = src.pages;
  const stage = useRef<HTMLDivElement>(null);
  const finishU = useRef<FinishUniforms[]>([]);
  // the finish per page; for our own brochure it comes from finishes.json (read from the page markers)
  const [ownFinishes, setOwnFinishes] = useState<(string | null)[]>([]);
  const finishes = source ? source.finishes : ownFinishes;
  useEffect(() => {
    if (source) return;
    fetch("/brochure-3d/finishes.json").then((r) => r.json()).then(setOwnFinishes).catch(() => {});
  }, [source]);
  useEffect(() => {
    finishU.current.forEach((u, p) => {
      if (!u) return;
      const f = FINISHES[finishes[p - 1] ?? "none"] ?? FINISHES.none;
      (Object.keys(f) as (keyof Finish)[]).forEach((k) => (u[k].value = f[k]));
    });
  }, [finishes]);
  const api = useRef<{ go: (dir: 1 | -1) => void } | null>(null);
  const [turned, setTurned] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [needsTilt, setNeedsTilt] = useState(false);
  // hidden settings panel for the team: only with ?instellen in the address
  const foilGain = source ? PDF_FOIL : 1;
  const look = useRef<Look>({ foil: { value: LOOK.foil * foilGain }, paper: { value: LOOK.paper }, uv: { value: LOOK.uv }, ink: { value: LOOK.ink }, coat: { value: LOOK.coat }, soft: { value: source ? live.soft : 0 }, holo: { value: 0.55 } });
  const [tune, setTune] = useState<null | { foil: number; paper: number; uv: number; ink: number; coat: number }>(null);
  useEffect(() => {
    if (new URLSearchParams(location.search).has("instellen")) setTune({ foil: 100, paper: 100, uv: 100, ink: 100, coat: 100 });
  }, []);
  useEffect(() => {
    if (!tune) return;
    look.current.foil.value = (LOOK.foil * foilGain * tune.foil) / 100;
    look.current.paper.value = (LOOK.paper * tune.paper) / 100;
    look.current.uv.value = (LOOK.uv * tune.uv) / 100;
    look.current.ink.value = Math.min(1, (LOOK.ink * tune.ink) / 100);
    look.current.coat.value = (LOOK.coat * tune.coat) / 100;
  }, [tune]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
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
    scene.environmentIntensity = 1;

    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
    const book = new THREE.Group();
    book.rotation.x = -0.32;
    scene.add(book);

    // the table: catches the book's shadow and a pool of light
    const table = new THREE.Mesh(new THREE.PlaneGeometry(12, 9), new THREE.MeshStandardMaterial({ color: "#1a1a1d", roughness: 0.95 }));
    table.position.z = -0.012;
    table.receiveShadow = true;
    book.add(table);

    const key = new THREE.SpotLight("#fff8ee", 7, 0, 0.62, 0.85, 1.6);
    key.position.set(-1.6, 2.4, 3.4);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.015;
    key.shadow.radius = 6;
    book.add(key, key.target);
    const fill = new THREE.HemisphereLight("#ffffff", "#3a3a40", 0.55);
    scene.add(fill);
    const torch = new PointerLamp(scene, el, () => lampRef.current);

    // pages: sheet i carries page 2i+1 on the front and 2i+2 on the back
    const H = src.aspect * W;
    const loader = new THREE.TextureLoader();
    const aniso = renderer.capabilities.getMaxAnisotropy();
    // until its textures arrive a page is plain paper; far-away pages give their textures back
    const blank = (rgba: number[], srgb: boolean) => {
      const tx = new THREE.DataTexture(new Uint8Array(rgba), 1, 1);
      if (srgb) tx.colorSpace = THREE.SRGBColorSpace;
      tx.needsUpdate = true;
      return tx;
    };
    const blankMap = blank([255, 255, 255, 255], true), blankPbr = blank([0, 0, 0, 255], false);
    // finish per page: uniforms, set from `finishes` (see the effect above), so a change needs no rebuild
    finishU.current = [];
    const finishOf = (p: number) => {
      const n = FINISHES[finishes[p - 1] ?? "none"] ?? FINISHES.none;
      return (finishU.current[p] = { coat: { value: n.coat }, coatRough: { value: n.coatRough }, foilRough: { value: n.foilRough }, haze: { value: n.haze } });
    };
    const SHEETS = Math.ceil(PAGES / 2);
    const sheets = Array.from({ length: SHEETS }, (_, i) => {
      const geo = sheetGeometry();
      const mats = [2 * i + 1, 2 * i + 2].map((p) => {
        const f = finishOf(p);
        return pageMaterial(blankMap, blankPbr, look.current, f, src.emboss ? blankPbr : undefined, src.holo ? blankPbr : undefined);
      });
      const mesh = new THREE.Mesh(geo, mats);
      mesh.castShadow = mesh.receiveShadow = true;
      book.add(mesh);
      return { mesh, mats, geo, t: 0, lag: 0, twist: 0, dirty: true, loaded: false };
    });
    const firstNeed = Math.min(4, PAGES), firstSeen = new Set<number>();
    const loadSheet = (i: number) => {
      const s = sheets[i];
      if (s.loaded) return;
      s.loaded = true;
      [2 * i + 1, 2 * i + 2].forEach((p, side) => {
        const m = s.mats[side];
        const mapUrl = p <= PAGES ? src.map(p, small) : null, pbrUrl = p <= PAGES ? src.pbr(p, small) : null;
        const bumpUrl = p <= PAGES ? src.emboss?.(p, small) ?? null : null;
        const holoUrl = p <= PAGES ? src.holo?.(p, small) ?? null : null;
        // ready once the first pages (up to 4) have their print
        const arrived = () => { if (p <= firstNeed) { firstSeen.add(p); if (firstSeen.size === firstNeed) setReady(true); } };
        if (!mapUrl) { arrived(); return; }
        loader.load(mapUrl, (tx) => {
          if (!s.loaded) return tx.dispose();
          tx.colorSpace = THREE.SRGBColorSpace;
          tx.anisotropy = aniso;
          m.map = tx;
          arrived();
        }, undefined, () => setFailed(true));
        if (pbrUrl) loader.load(pbrUrl, (tx) => {
          if (!s.loaded) return tx.dispose();
          tx.anisotropy = aniso;
          m.roughnessMap = m.metalnessMap = m.clearcoatMap = tx;
        });
        if (bumpUrl) loader.load(bumpUrl, (tx) => {
          if (!s.loaded) return tx.dispose();
          m.bumpMap = tx;
        });
        if (holoUrl) loader.load(holoUrl, (tx) => {
          if (!s.loaded) return tx.dispose();
          setHolo(m, tx);
        });
      });
    };
    const unloadSheet = (i: number) => {
      const s = sheets[i];
      if (!s.loaded) return;
      s.loaded = false;
      s.mats.forEach((m) => {
        if (m.map !== blankMap) m.map?.dispose();
        if (m.roughnessMap !== blankPbr) m.roughnessMap?.dispose();
        if (m.bumpMap && m.bumpMap !== blankPbr) { m.bumpMap.dispose(); m.bumpMap = blankPbr; }
        const h = (m.userData as { holo?: { value: THREE.Texture } }).holo;
        if (h && h.value !== blankPbr) { h.value.dispose(); setHolo(m, blankPbr); }
        m.map = blankMap;
        m.roughnessMap = m.metalnessMap = m.clearcoatMap = blankPbr;
      });
    };
    // keep the open spread and two sheets either side; only those are drawn, the rest lie hidden in the stacks
    const around = () => {
      sheets.forEach((s, i) => {
        const d = i < cur ? cur - 1 - i : i - cur;
        if (d <= 2) loadSheet(i);
        else if (d > 4) unloadSheet(i);
        s.mesh.visible = d <= 2;
        s.dirty = true;
      });
    };

    // state
    let cur = 0; // sheets turned
    let drag: { sheet: number; x0: number; y0: number; t0: number; moved: boolean; lastX: number; v: number } | null = null;
    const pointer = { x: 0.5, y: 0.4, tx: 0.5, ty: 0.4 };
    let tilt: { x: number; y: number } | null = null;
    let width = 1, heightPx = 1, pagePx = 300;

    const turnTo = (i: number, to: 0 | 1, from?: number) => {
      const s = sheets[i];
      gsap.killTweensOf(s);
      const dist = Math.abs(to - (from ?? s.t));
      gsap.to(s, {
        t: to,
        duration: reduce ? 0.25 : 0.5 + 0.75 * dist,
        ease: "power2.inOut",
        onUpdate: () => { s.dirty = true; },
      });
      gsap.to(s, { lag: to === 1 ? 1.25 : -1.25, duration: 0.18, ease: "power1.out", overwrite: false });
      gsap.to(s, { lag: 0, twist: 0, duration: reduce ? 0.25 : 0.9 + 0.5 * dist, delay: 0.15, ease: "power2.out", overwrite: false });
    };
    // a single loose page (a flyer, a card) lies still: nothing to turn
    const still = PAGES === 1;
    const go = (d: 1 | -1) => {
      if (still) return;
      if (d === 1 && cur < SHEETS) { turnTo(cur, 1); cur++; }
      else if (d === -1 && cur > 0) { cur--; turnTo(cur, 0); }
      setTurned(cur);
      around();
    };
    around();
    api.current = { go };

    /*
     * The camera follows the book: as close as possible, but always far enough away that every corner of the
     * book (and of a page standing up mid-turn) stays inside the frame, however far the book is turned.
     * It backs off quickly and comes closer again slowly.
     */
    const v = new THREE.Vector3();
    const corners: THREE.Vector3[] = [];
    let camDist = 0; // 0 = jump straight to the fit (first frame, after a resize)
    const place = (dist: number) => {
      camera.position.set(0, -0.08, dist);
      camera.lookAt(0, -0.04, 0);
      camera.updateMatrixWorld();
    };
    const fitDistance = () => {
      book.updateMatrixWorld();
      corners.length = 0;
      const add = (x: number, z: number) => {
        for (const y of [-H / 2, H / 2]) corners.push(new THREE.Vector3(x, y, z).applyMatrix4(book.matrixWorld));
      };
      add(sheets.some((s) => s.t > 0) ? -W : 0, 0);
      add(sheets.some((s) => s.t < 1) ? W : 0, 0);
      sheets.forEach((s) => {
        if (s.t > 0 && s.t < 1) add(W * Math.cos(s.t * Math.PI), W * Math.sin(s.t * Math.PI));
      });
      let lo = 0.5, hi = 40;
      for (let k = 0; k < 18; k++) {
        const mid = (lo + hi) / 2;
        place(mid);
        if (corners.every((c) => Math.abs(v.copy(c).project(camera).x) < 0.95 && Math.abs(v.y) < 0.95)) hi = mid;
        else lo = mid;
      }
      return hi;
    };
    const resize = () => {
      width = el.clientWidth;
      heightPx = el.clientHeight;
      renderer.setSize(width, heightPx, false);
      composer.setSize(width, heightPx);
      camera.aspect = width / heightPx;
      camera.updateProjectionMatrix();
      camDist = 0;
    };

    // the bloom pass needs its own render target; give it 4x multisampling so page edges stay smooth
    const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.16, 0.2, 3);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    // pointer: light follows; drag turns a page; a click turns to the side clicked
    const down = (e: PointerEvent) => {
      if (still || e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const right = x > r.width / 2;
      const sheet = right ? cur : cur - 1;
      if (sheet < 0 || sheet >= SHEETS) return;
      gsap.killTweensOf(sheets[sheet]);
      drag = { sheet, x0: e.clientX, y0: e.clientY - r.top, t0: sheets[sheet].t, moved: false, lastX: e.clientX, v: 0 };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      if (!drag) {
        // the book turns towards the pointer (not while a page is being dragged)
        pointer.tx = (e.clientX - r.left) / r.width;
        pointer.ty = (e.clientY - r.top) / r.height;
        return;
      }
      const dx = e.clientX - drag.x0;
      if (Math.abs(dx) > 6) drag.moved = true;
      if (!drag.moved) return;
      const s = sheets[drag.sheet];
      s.t = Math.min(1, Math.max(0, drag.t0 - dx / (pagePx * 2)));
      drag.v = 0.7 * drag.v + 0.3 * (drag.lastX - e.clientX);
      drag.lastX = e.clientX;
      s.lag = Math.max(-1.6, Math.min(1.6, drag.v * 0.1 + (s.t - drag.t0) * 0.9));
      s.twist = (drag.y0 / r.height - 0.5) * -1.4;
      s.dirty = true;
    };
    const up = () => {
      if (!drag) return;
      const { sheet, moved, v } = drag;
      drag = null;
      const s = sheets[sheet];
      if (!moved) { go(sheet === cur ? 1 : -1); return; }
      const forward = v > 4 ? true : v < -4 ? false : s.t > 0.5;
      if (forward && sheet === cur) { cur++; turnTo(sheet, 1); }
      else if (!forward && sheet === cur - 1) { cur--; turnTo(sheet, 0); }
      else turnTo(sheet, forward ? 1 : 0);
      setTurned(cur);
      around();
    };
    const leave = () => { if (!drag) { pointer.tx = 0.5; pointer.ty = 0.4; } };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", leave);
    const keys = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") { go(1); e.preventDefault(); }
      if (e.key === "ArrowLeft") { go(-1); e.preventDefault(); }
    };
    el.addEventListener("keydown", keys);

    // phones: tilt moves the light (iOS asks permission first, see the button)
    const orient = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      tilt = { x: Math.max(-1, Math.min(1, e.gamma / 30)), y: Math.max(-1, Math.min(1, (e.beta - 40) / 30)) };
    };
    const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    if (DOE?.requestPermission && matchMedia("(pointer: coarse)").matches) setNeedsTilt(true);
    else window.addEventListener("deviceorientation", orient);
    (el as HTMLDivElement & { askTilt?: () => void }).askTilt = () => {
      DOE?.requestPermission?.().then((p) => {
        if (p === "granted") window.addEventListener("deviceorientation", orient);
      }).catch(() => {}).finally(() => setNeedsTilt(false));
    };

    // render only while visible
    let visible = true;
    const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; });
    io.observe(el);
    const clock = new THREE.Clock();
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) return;
      const time = clock.getElapsedTime();
      // the light drifts a little by itself, so the foil keeps moving
      const idle = reduce ? 0 : 1;
      let lx = pointer.tx - 0.5 + idle * 0.06 * Math.sin(time * 0.5);
      let ly = pointer.ty - 0.45 + idle * 0.04 * Math.cos(time * 0.37);
      if (tilt) { lx = tilt.x * 0.5; ly = tilt.y * 0.45; }
      // never further than the camera fit allows (ROT_X / ROT_Y)
      lx = Math.max(-0.6, Math.min(0.6, lx));
      ly = Math.max(-0.6, Math.min(0.6, ly));
      pointer.x += (lx - pointer.x) * 0.08;
      pointer.y += (ly - pointer.y) * 0.08;
      scene.environmentRotation.set(pointer.y * 0.9, -pointer.x * 1.6, 0);
      key.position.set(-1.6 + pointer.x * 3, 2.4 - pointer.y * 2.5, 3.4);
      book.rotation.y = pointer.x * 1.05;
      book.rotation.x = -0.3 + pointer.y * 0.75;
      const dim = torch.update(camera, book, time);
      // in the PDF tool the hidden settings panel (tuning.ts) works here too; the brochure page keeps its own
      const T = (k: Parameters<typeof tf>[0]) => (source ? tf(k) : 1);
      key.intensity = 7 * T("key") * (1 - dim);
      fill.intensity = 0.55 * T("env") * (1 - dim);
      scene.environmentIntensity = Math.max(0.25, 1 - dim * 1.3) * T("env");
      if (source) {
        renderer.toneMappingExposure = 1.05 * tf("exposure");
        const L = look.current;
        L.foil.value = LOOK.foil * foilGain * tf("foil");
        L.paper.value = LOOK.paper * tf("paper");
        L.uv.value = LOOK.uv * tf("uv");
        L.ink.value = Math.min(1, LOOK.ink * tf("ink"));
        L.coat.value = LOOK.coat * tf("coat");
        L.soft!.value = live.soft;
        L.holo!.value = live.holo / 100;
      }

      // the book slides so a closed cover (or back) sits in the middle
      const p = sheets.reduce((a, s) => a + s.t, 0);
      book.position.x = p < 1 ? -(1 - p) * W * 0.5 : p > SHEETS - 1 ? (p - (SHEETS - 1)) * W * 0.5 : 0;

      sheets.forEach((s, i) => {
        if (!s.dirty) return;
        // only the three top sheets of each stack get a height (the rest are hidden), so both sides are equally high
        const zRight = Math.max(0, 3 - (i - cur)) * GAP, zLeft = Math.max(0, 3 - (cur - 1 - i)) * GAP;
        bend(s.geo, H, s.t, s.lag, s.twist, zRight + (zLeft - zRight) * s.t);
        s.dirty = s.t > 0 && s.t < 1 ? true : Math.abs(s.lag) > 0.001 || Math.abs(s.twist) > 0.001;
      });
      const target = fitDistance();
      camDist = camDist === 0 ? target : camDist + (target - camDist) * (target > camDist ? 0.25 : 0.05);
      place(camDist);
      // pixels per page width, for dragging (kept still while a page is being dragged)
      if (!drag) pagePx = (W / (2 * camDist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))) * heightPx;
      composer.render();
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      torch.dispose();
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("deviceorientation", orient);
      sheets.forEach((s) => gsap.killTweensOf(s));
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: THREE.Material & { map?: THREE.Texture; roughnessMap?: THREE.Texture }) => {
            m.map?.dispose();
            m.roughnessMap?.dispose();
            m.dispose();
          });
        }
      });
      blankMap.dispose();
      blankPbr.dispose();
      scene.environment?.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    // the scene is built once per set of pages; finish changes go through the uniforms
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src.map, src.pbr, src.pages, src.aspect]);

  const SHEETS = Math.ceil(PAGES / 2);
  const label = turned === 0 ? "1" : turned === SHEETS ? String(PAGES) : `${turned * 2}–${Math.min(PAGES, turned * 2 + 1)}`;

  const pageBar = (
    <div className="brochure3d-bar">
      <button type="button" className="brochure3d-btn prev" onClick={() => api.current?.go(-1)} disabled={turned === 0} aria-label={t.prev}>
        <Arrow />
      </button>
      <span className="brochure3d-page">
        {t.page} {label} / {PAGES}
      </span>
      <button type="button" className="brochure3d-btn" onClick={() => api.current?.go(1)} disabled={turned === SHEETS} aria-label={t.next}>
        <Arrow />
      </button>
    </div>
  );

  const body = (
    <>
        <div ref={stage} className="brochure3d-stage" tabIndex={0} aria-label={t.hint}>
          {!ready && !failed && <p className="brochure3d-status">{t.loading}</p>}
          {failed && <p className="brochure3d-status">{t.noWebgl}</p>}
          {needsTilt && (
            <button
              type="button"
              className="brochure3d-tilt"
              onClick={() => (stage.current as (HTMLDivElement & { askTilt?: () => void }) | null)?.askTilt?.()}
            >
              {t.tilt}
            </button>
          )}
        </div>
        {PAGES > 1 && (<>
        {controls === undefined ? pageBar : controls && createPortal(pageBar, controls)}
        <p className="brochure3d-hint">{t.hint}</p>
        </>)}
        {tune && (
          <div className="brochure3d-tune">
            {(
              [
                ["foil", "Glans folie"],
                ["ink", "CMYK op folie"],
                ["paper", "Helderheid pagina's"],
                ["uv", "Glans SpotUV"],
                ["coat", "Vernis / laminaat"],
              ] as const
            ).map(([k, label]) => (
              <label key={k}>
                <span>{label}</span>
                <input type="range" min={0} max={200} step={5} value={tune[k]} onChange={(e) => setTune({ ...tune, [k]: Number(e.target.value) })} />
                <b>{tune[k]}%</b>
              </label>
            ))}
            <p>100% = huidige standaard. Geef de getallen door, dan worden ze de standaard voor iedereen. Dit paneel zien klanten niet.</p>
          </div>
        )}
    </>
  );
  // bare: inside another tool (the PDF-in-3D page), which brings its own section
  return bare ? body : (
    <section className="section first brochure3d">
      <div className="wrap">{body}</div>
    </section>
  );
}
