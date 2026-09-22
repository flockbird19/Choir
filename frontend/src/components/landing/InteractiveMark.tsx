"use client";

import { useEffect, useRef } from "react";

// The Choir mark, rendered as particles instead of static SVG paths. Coordinates are
// copied verbatim from components/Logo.tsx (DESIGN.md 9: never approximate the mark).
// Hovering scatters the particles away from the pointer; they spring back to their
// resting position on their own. Off entirely under prefers-reduced-motion.
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

interface Particle {
  hx: number;
  hy: number;
  r: number;
  a: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function buildParticles(): Particle[] {
  const points: Omit<Particle, "x" | "y" | "vx" | "vy">[] = [];

  SPOKES.forEach((spoke) => {
    const steps = 16;
    for (let i = 3; i <= steps; i++) {
      const t = i / steps;
      points.push({
        hx: CENTER.x + (spoke.x - CENTER.x) * t,
        hy: CENTER.y + (spoke.y - CENTER.y) * t,
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
        hx: tip.x + Math.cos(angle) * tip.rx * spread,
        hy: tip.y + Math.sin(angle) * tip.ry * spread,
        r: 1.1 + Math.random() * 0.9,
        a: 0.7 + Math.random() * 0.3,
      });
    }
  });

  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    points.push({
      hx: CENTER.x + Math.cos(angle) * 5,
      hy: CENTER.y + Math.sin(angle) * 5,
      r: 1.4,
      a: 0.6,
    });
  }

  return points.map((p) => ({ ...p, x: p.hx, y: p.hy, vx: 0, vy: 0 }));
}

export function InteractiveMark() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const particles = buildParticles();
    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;
    let pointer: { x: number; y: number } | null = null;
    let running = false;
    let frame = 0;

    function resize() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      scale = Math.min(rect.width, rect.height) / VIEWBOX;
      offsetX = (rect.width - VIEWBOX * scale) / 2;
      offsetY = (rect.height - VIEWBOX * scale) / 2;
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
    draw();
    window.addEventListener("resize", resize);

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
      aria-label="The Choir mark, made of scattering dots. Move your cursor over it to see it drift and settle."
      className="block h-[min(46vw,320px)] w-[min(560px,92%)] cursor-pointer"
    />
  );
}
