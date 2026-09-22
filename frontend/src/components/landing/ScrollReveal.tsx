"use client";

import { useEffect } from "react";

// Fades each section up as it enters the viewport, exactly like the approved mockup.
// Off entirely under prefers-reduced-motion. Renders nothing itself.
export function ScrollReveal() {
  useEffect(() => {
    const root = document.querySelector(".choir-landing");
    if (!root) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || !("IntersectionObserver" in window)) return;

    const targets = root.querySelectorAll<HTMLElement>(".product-stage, .section > .wrap, .audience-layout");
    targets.forEach((el) => {
      el.style.opacity = "0";
      el.style.transform = "translateY(24px)";
      el.style.willChange = "opacity, transform";
      el.style.transition = "opacity 700ms cubic-bezier(0.16, 1, 0.3, 1), transform 700ms cubic-bezier(0.16, 1, 0.3, 1)";
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target as HTMLElement;
          el.style.opacity = "1";
          el.style.transform = "translateY(0)";
          window.setTimeout(() => {
            el.style.willChange = "auto";
          }, 720);
          observer.unobserve(el);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );

    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return null;
}
