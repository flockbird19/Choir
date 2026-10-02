"use client";

import { useEffect, useRef } from "react";

// The Choir mark and name, rendered as particles instead of static SVG paths. Mark
// coordinates are copied verbatim from components/Logo.tsx (DESIGN.md 9: never approximate
// the mark); the name is sampled from the real Newsreader wordmark, sized like the header's
// logo + name. Hovering scatters the particles away from the pointer; they spring back to
// their resting position on their own. Off entirely under prefers-reduced-motion.
const CENTER = { x: 110, y: 110 };
const SPOKES = [
  { x: 192, y: 97, w: 2.5 },
  { x: 176, y: 48, w: 1.5 },
  { x: 132, y: 24, w: 1.5 },
  { x: 62, y: 20, w: 1.5 },
  { x: 22, y: 46, w: 1.5 },
  { x: 24, y: 132, w: 1.5 },
  { x: 70, y: 196, w: 1.5 },
  { x: 146, y: 182, w: 1.5 },
];
const TIPS = [
  { x: 192, y: 97, rx: 6, ry: 4.5 },
  { x: 176, y: 48, rx: 6, ry: 4.5 },
  { x: 132, y: 24, rx: 5, ry: 6 },
  { x: 62, y: 20, rx: 5, ry: 6 },
  { x: 22, y: 46, rx: 6, ry: 4.5 },
  { x: 24, y: 132, rx: 6, ry: 4.5 },
  { x: 70, y: 196, rx: 5, ry: 6 },
  { x: 146, y: 182, rx: 5, ry: 6 },
];
const VIEWBOX = 220;
// Header proportions: a 29px mark beside 25px Newsreader 500 with -0.03em tracking, 9px apart.
const FONT_SIZE = (VIEWBOX * 25) / 29;
const GAP = (VIEWBOX * 9) / 29;
const STEP = 4.5; // sampling grid for the name, in mark units

interface Particle {
  /** Resting position inside its own group (mark: 0..220; name: its ink box). */
  rx: number;
  ry: number;
  name: boolean;
  hx: number;
  hy: number;
  r: number;
  a: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

type Point = Pick<Particle, "rx" | "ry" | "r" | "a">;

function markPoints(): Point[] {
  const points: Point[] = [];

  SPOKES.forEach((spoke) => {
    const steps = 16;
    for (let i = 3; i <= steps; i++) {
      const t = i / steps;
      points.push({
        rx: CENTER.x + (spoke.x - CENTER.x) * t,
        ry: CENTER.y + (spoke.y - CENTER.y) * t,
        r: spoke.w * 0.9,
        a: 0.5 + 0.4 * t,
      });
    }
  });

  TIPS.forEach((tip) => {
    const dots = 22;
    for (let i = 0; i < dots; i++) {
      const angle = (i / dots) * Math.PI * 2;
      const spread = 0.35 + 0.65 * Math.random();
      points.push({
        rx: tip.x + Math.cos(angle) * tip.rx * spread,
        ry: tip.y + Math.sin(angle) * tip.ry * spread,
        r: 1.1 + Math.random() * 0.9,
        a: 0.7 + Math.random() * 0.3,
      });
    }
  });

  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    points.push({
      rx: CENTER.x + Math.cos(angle) * 5,
      ry: CENTER.y + Math.sin(angle) * 5,
      r: 1.4,
      a: 0.6,
    });
  }
  return points;
}

/** "Choir" drawn off-screen in the wordmark font, then sampled on a grid; returns the dots and the ink box. */
function namePoints(family: string): { points: Point[]; w: number; h: number } {
  const pad = 8;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { points: [], w: 0, h: 0 };
  const font = `500 ${FONT_SIZE}px ${family}`;
  ctx.font = font;
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${-0.03 * FONT_SIZE}px`;
  const m = ctx.measureText("Choir");
  const w = Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
  const h = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent);
  canvas.width = w + pad * 2;
  canvas.height = h + pad * 2;
  ctx.font = font; // resizing the canvas resets its state
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${-0.03 * FONT_SIZE}px`;
  ctx.fillText("Choir", pad + m.actualBoundingBoxLeft, pad + m.actualBoundingBoxAscent);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const points: Point[] = [];
  for (let y = 0; y < canvas.height; y += STEP) {
    for (let x = 0; x < canvas.width; x += STEP) {
      const jx = x + (Math.random() - 0.5) * 1.2;
      const jy = y + (Math.random() - 0.5) * 1.2;
      if (data[(Math.round(jy) * canvas.width + Math.round(jx)) * 4 + 3] > 140) {
        points.push({ rx: jx - pad, ry: jy - pad, r: 1.45 + Math.random() * 0.5, a: 0.7 + Math.random() * 0.3 });
      }
    }
  }
  return { points, w, h };
}

export function InteractiveMark() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const particles: Particle[] = markPoints().map((p) => ({ ...p, name: false, hx: 0, hy: 0, x: 0, y: 0, vx: 0, vy: 0 }));
    let nameBox = { w: 0, h: 0 };
    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;
    let pointer: { x: number; y: number } | null = null;
    let running = false;
    let frame = 0;
    let cancelled = false;

    // Name beside the mark on wide screens, below it on narrow ones; both centred.
    function layout(snap: boolean) {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const stacked = rect.width < 520;
      const { w: nw, h: nh } = nameBox;
      const W = nw === 0 ? VIEWBOX : stacked ? Math.max(VIEWBOX, nw) : VIEWBOX + GAP + nw;
      const H = nw === 0 ? VIEWBOX : stacked ? VIEWBOX + GAP + nh : VIEWBOX;
      const mark = stacked ? { x: (W - VIEWBOX) / 2, y: 0 } : { x: 0, y: 0 };
      const name = stacked ? { x: (W - nw) / 2, y: VIEWBOX + GAP } : { x: VIEWBOX + GAP, y: (VIEWBOX - nh) / 2 };
      scale = Math.min(rect.width / W, rect.height / H);
      offsetX = (rect.width - W * scale) / 2;
      offsetY = (rect.height - H * scale) / 2;
      particles.forEach((p) => {
        const o = p.name ? name : mark;
        p.hx = o.x + p.rx;
        p.hy = o.y + p.ry;
        if (snap) {
          p.x = p.hx;
          p.y = p.hy;
        }
      });
    }

    function resize() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      layout(true);
      draw();
    }

    function toCanvas(p: { x: number; y: number }) {
      return { x: offsetX + p.x * scale, y: offsetY + p.y * scale };
    }

    function draw() {
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);
      particles.forEach((p) => {
        const c = toCanvas(p);
        ctx.beginPath();
        ctx.arc(c.x, c.y, p.r * scale, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(37, 80, 143, ${p.a})`;
        ctx.fill();
      });
    }

    function settle() {
      let moving = false;
      particles.forEach((p) => {
        let fx = (p.hx - p.x) * 0.06;
        let fy = (p.hy - p.y) * 0.06;
        if (pointer) {
          const c = toCanvas(p);
          const dx = c.x - pointer.x;
          const dy = c.y - pointer.y;
          const dist = Math.hypot(dx, dy) || 1;
          const radius = 70;
          if (dist < radius) {
            const push = (1 - dist / radius) * 16;
            fx += (dx / dist) * (push / scale);
            fy += (dy / dist) * (push / scale);
          }
        }
        p.vx = (p.vx + fx) * 0.82;
        p.vy = (p.vy + fy) * 0.82;
        p.x += p.vx;
        p.y += p.vy;
        if (Math.abs(p.vx) > 0.01 || Math.abs(p.vy) > 0.01 || Math.abs(p.x - p.hx) > 0.05) moving = true;
      });
      return moving;
    }

    function loop() {
      const moving = settle();
      draw();
      if (moving || pointer) {
        frame = requestAnimationFrame(loop);
      } else {
        running = false;
      }
    }

    function wake() {
      if (!running) {
        running = true;
        frame = requestAnimationFrame(loop);
      }
    }

    resize();
    window.addEventListener("resize", resize);

    // The name waits for the wordmark font, or it would be sampled from a fallback serif.
    const family = getComputedStyle(canvas).getPropertyValue("--font-newsreader").trim() || "Georgia, serif";
    document.fonts.load(`500 ${FONT_SIZE}px ${family}`).finally(() => {
      if (cancelled) return;
      const sampled = namePoints(family);
      nameBox = { w: sampled.w, h: sampled.h };
      sampled.points.forEach((p) => particles.push({ ...p, name: true, hx: 0, hy: 0, x: 0, y: 0, vx: 0, vy: 0 }));
      resize();
    });

    function handleMove(event: PointerEvent) {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      wake();
    }
    function handleLeave() {
      pointer = null;
      wake();
    }

    if (!reduceMotion) {
      canvas.addEventListener("pointermove", handleMove);
      canvas.addEventListener("pointerleave", handleLeave);
    }

    return () => {
      cancelled = true;
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointermove", handleMove);
      canvas.removeEventListener("pointerleave", handleLeave);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="The Choir mark and name, made of scattering dots. Move your cursor over them to see them drift and settle."
      className="block h-[min(52vw,260px)] w-[min(820px,92%)] cursor-pointer"
    />
  );
}
