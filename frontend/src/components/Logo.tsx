import React from 'react'

interface LogoProps {
  className?: string
}

/**
 * Choir logo — three overlapping speech bubbles arranged in a fan/arc,
 * representing multiple voices harmonizing together.
 * Single-color SVG (fill=currentColor), viewBox 0 0 32 32.
 */
export function Logo({ className }: LogoProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      aria-label="Choir logo"
      className={className}
    >
      {/*
        Three speech bubbles arranged in a slight fan/arc.
        Each bubble is a rounded rectangle with a small triangular tail.
        They overlap to evoke voices harmonizing together.

        Bubble 1 — bottom-left, tilted left
        Bubble 2 — center, upright (dominant)
        Bubble 3 — bottom-right, tilted right
      */}

      {/* Bubble 1: left voice, rotated -18deg around center */}
      <g transform="rotate(-18, 16, 16)" opacity="0.55">
        <rect x="5" y="7" width="14" height="10" rx="3" ry="3" />
        <polygon points="8,17 6,21 11,17" />
      </g>

      {/* Bubble 3: right voice, rotated +18deg around center */}
      <g transform="rotate(18, 16, 16)" opacity="0.55">
        <rect x="13" y="7" width="14" height="10" rx="3" ry="3" />
        <polygon points="24,17 26,21 21,17" />
      </g>

      {/* Bubble 2: center voice, upright and on top */}
      <rect x="9" y="6" width="14" height="10" rx="3" ry="3" />
      <polygon points="14,16 12,21 17,16" />
    </svg>
  )
}

export default Logo
