import React from 'react'

interface LogoProps {
  className?: string
}

export function Logo({ className }: LogoProps) {
  return (
    <svg
      viewBox="0 0 220 220"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Choir logo"
      className={className}
    >
      <g stroke="currentColor" strokeLinecap="round" fill="none">
        <line x1="110" y1="110" x2="192" y2="97" strokeWidth="2.5"/>
        <line x1="110" y1="110" x2="176" y2="48" strokeWidth="1.5"/>
        <line x1="110" y1="110" x2="132" y2="24" strokeWidth="1.5"/>
        <line x1="110" y1="110" x2="62" y2="20" strokeWidth="1.5"/>
        <line x1="110" y1="110" x2="22" y2="46" strokeWidth="1.5"/>
        <line x1="110" y1="110" x2="24" y2="132" strokeWidth="1.5"/>
        <line x1="110" y1="110" x2="70" y2="196" strokeWidth="1.5"/>
        <line x1="110" y1="110" x2="146" y2="182" strokeWidth="1.5"/>
      </g>
      <g fill="currentColor">
        <ellipse cx="192" cy="97" rx="6" ry="4.5" transform="rotate(10 192 97)"/>
        <ellipse cx="176" cy="48" rx="6" ry="4.5" transform="rotate(-55 176 48)"/>
        <ellipse cx="132" cy="24" rx="5" ry="6" transform="rotate(-15 132 24)"/>
        <ellipse cx="62" cy="20" rx="5" ry="6" transform="rotate(15 62 20)"/>
        <ellipse cx="22" cy="46" rx="6" ry="4.5" transform="rotate(50 22 46)"/>
        <ellipse cx="24" cy="132" rx="6" ry="4.5" transform="rotate(-40 24 132)"/>
        <ellipse cx="70" cy="196" rx="5" ry="6" transform="rotate(15 70 196)"/>
        <ellipse cx="146" cy="182" rx="5" ry="6" transform="rotate(-20 146 182)"/>
      </g>
    </svg>
  )
}

export default Logo
