"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * The wax seal, in three dimensions.
 *
 * Ported from the design handoff's seal3d.js with two deliberate changes.
 *
 * 1. `three` is imported from the bundle, not from esm.sh at runtime. The
 *    handoff does a dynamic import from a CDN, which means the hero silently
 *    falls back to flat SVG on any network that blocks it, and leaks a request
 *    to a third party on every page view.
 * 2. One frame is rendered SYNCHRONOUSLY before the animation loop starts.
 *    Where requestAnimationFrame is throttled - a background tab, a hidden
 *    pane, a screenshot harness - the loop may never fire, and without this
 *    the hero is an empty canvas rather than a still seal.
 *
 * Reduced motion is honoured by holding a fixed, slightly-turned pose rather
 * than by hiding the object: the seal is the page's only illustration.
 */
export default function Seal3D({ color = "#A6321F" }: { color?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    let dead = false;
    let raf = 0;

    const width = () => el.clientWidth || 480;
    const height = () => el.clientHeight || 420;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      // No WebGL. The flat mark underneath stays visible; nothing to clean up.
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width(), height());
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%";
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, width() / height(), 0.1, 100);
    camera.position.set(0, 0, 9.6);

    const group = new THREE.Group();
    scene.add(group);

    // --- the wax blob, with an irregular pressed edge ---------------------
    const shape = new THREE.Shape();
    const R = 1.62;
    const N = 260;
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * Math.PI * 2;
      const r =
        R +
        Math.sin(t * 23) * 0.035 +
        Math.sin(t * 7 + 1.2) * 0.052 +
        Math.cos(t * 3 + 0.4) * 0.042 +
        Math.sin(t * 11 + 2.4) * 0.022;
      const x = Math.cos(t) * r;
      const y = Math.sin(t) * r;
      if (i) shape.lineTo(x, y);
      else shape.moveTo(x, y);
    }

    const waxGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.22,
      bevelEnabled: true,
      bevelThickness: 0.26,
      bevelSize: 0.2,
      bevelOffset: 0,
      bevelSegments: 10,
      curveSegments: 12,
    });
    waxGeo.center();

    const waxMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(color),
      roughness: 0.44,
      metalness: 0,
      clearcoat: 0.55,
      clearcoatRoughness: 0.5,
      sheen: 0.6,
      sheenColor: new THREE.Color("#FF9C78"),
      sheenRoughness: 0.7,
    });
    group.add(new THREE.Mesh(waxGeo, waxMat));

    const faceZ = 0.24;
    const relief = waxMat.clone();
    relief.color = new THREE.Color(color).offsetHSL(0, -0.02, 0.055);
    const sunken = waxMat.clone();
    sunken.color = new THREE.Color(color).offsetHSL(0, 0.01, -0.075);
    sunken.roughness = 0.62;

    // --- the struck monogram ---------------------------------------------
    const cShape = new THREE.Shape();
    const a0 = THREE.MathUtils.degToRad(-42);
    const a1 = THREE.MathUtils.degToRad(216);
    cShape.absarc(0, 0, 1.02, a0, a1, false);
    cShape.absarc(0, 0, 0.66, a1, a0, true);
    const cGeo = new THREE.ExtrudeGeometry(cShape, {
      depth: 0.1,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.045,
      bevelSegments: 4,
      curveSegments: 48,
    });
    const monogram = new THREE.Mesh(cGeo, relief);
    monogram.position.z = faceZ;
    group.add(monogram);

    const termGeo = new THREE.BoxGeometry(0.3, 0.1, 0.14);
    ([[a0, -1], [a1, 1]] as [number, number][]).forEach(([a, s]) => {
      const t = new THREE.Mesh(termGeo, relief);
      t.position.set(Math.cos(a) * 0.84, Math.sin(a) * 0.84, faceZ + 0.06);
      t.rotation.z = a + (Math.PI / 2) * s;
      group.add(t);
    });

    // --- incised ring and dashed border ----------------------------------
    const groove = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.028, 10, 160), sunken);
    groove.position.z = faceZ - 0.02;
    group.add(groove);

    const dashGeo = new THREE.BoxGeometry(0.075, 0.035, 0.06);
    for (let i = 0; i < 52; i++) {
      const a = (i / 52) * Math.PI * 2;
      const d = new THREE.Mesh(dashGeo, relief);
      d.position.set(Math.cos(a) * 1.36, Math.sin(a) * 1.36, faceZ - 0.03);
      d.rotation.z = a;
      group.add(d);
    }

    // --- light -------------------------------------------------------------
    scene.add(new THREE.AmbientLight(0xffffff, 0.42));
    const key = new THREE.DirectionalLight(0xffffff, 2.5);
    key.position.set(3.4, 4.6, 5.2);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffc7a4, 0.85);
    fill.position.set(-4.5, 0.6, 2.4);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xf6eede, 1.5);
    rim.position.set(-1.2, -3.4, -3.6);
    scene.add(rim);
    const spark = new THREE.PointLight(0xffe3ce, 12, 18);
    spark.position.set(2.2, 2.4, 2.8);
    scene.add(spark);

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let px = 0;
    let py = 0;
    let tx = 0;
    let ty = 0;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
    };
    const onLeave = () => {
      tx = 0;
      ty = 0;
    };
    if (!still) {
      window.addEventListener("pointermove", onMove, { passive: true });
      el.addEventListener("pointerleave", onLeave);
    }

    const resize = () => {
      camera.aspect = width() / height();
      camera.updateProjectionMatrix();
      renderer.setSize(width(), height());
      renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    // The still pose, drawn once, before anything schedules a frame.
    group.rotation.set(-0.16, 0.28, 0.06);
    renderer.render(scene, camera);

    const t0 = performance.now();
    const tick = () => {
      if (dead) return;
      raf = requestAnimationFrame(tick);
      const t = (performance.now() - t0) / 1000;
      px += (tx - px) * 0.05;
      py += (ty - py) * 0.05;
      group.rotation.y = Math.sin(t * 0.33) * 0.42 + px * 0.42;
      group.rotation.x = -0.15 + Math.sin(t * 0.26) * 0.1 + py * 0.26;
      group.rotation.z = Math.sin(t * 0.19) * 0.05;
      group.position.y = Math.sin(t * 0.5) * 0.07;
      renderer.render(scene, camera);
    };
    if (!still) tick();

    return () => {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      waxGeo.dispose();
      cGeo.dispose();
      termGeo.dispose();
      dashGeo.dispose();
      waxMat.dispose();
      relief.dispose();
      sunken.dispose();
      renderer.dispose();
      // `dispose()` releases three's own resources but leaves the WebGL context
      // alive until the canvas is garbage collected, which is not prompt. A
      // browser keeps only about sixteen contexts and silently drops the oldest
      // past that, so client-side navigation back and forth to this page would
      // eventually kill the seal - and, worse, whichever other canvas was
      // oldest. Ask for the context back explicitly.
      renderer.forceContextLoss();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
    };
  }, [color]);

  return (
    <div
      ref={host}
      aria-hidden="true"
      style={{ position: "relative", width: "100%", height: "clamp(340px, 42vw, 540px)" }}
    />
  );
}
