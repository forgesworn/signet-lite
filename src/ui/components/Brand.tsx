// My Signet emblem — geometry and colours from
// branding/mysignet/svg/mysignet-emblem.svg (and its `-reversed` dark-mode
// counterpart), reproduced unmodified as inline SVG. Both variants render;
// CSS (.brand-mark-auto, global.css) shows only the one matching the
// current theme, so the navy stroke stays visible in dark mode.
function EmblemOnLight() {
  return (
    <svg
      className="brand-on-light"
      width="56"
      height="56"
      viewBox="229.5 232.0 821.0 821.0"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="640.0" cy="642.5" r="403.0" fill="none" stroke="#C9A962" strokeWidth="15.0" />
      <path
        d="M516.00 701.15 A251.5 251.5 0 0 1 328.50 463.90 C435.80 423.88 559.59 482.13 640.00 562.00 C757.04 678.25 778.04 873.34 640.00 971.77 C501.96 873.34 522.96 678.25 640.00 562.00 C720.41 482.13 844.20 423.88 951.50 463.90 A251.5 251.5 0 0 1 764.00 701.15"
        fill="none"
        stroke="#0E2A47"
        strokeWidth="28.0"
        strokeLinejoin="miter"
        strokeMiterlimit="10"
        strokeLinecap="butt"
      />
      <path
        d="M569.00 715.53 A271.0 271.0 0 0 0 711.00 715.53"
        fill="none"
        stroke="#C9A962"
        strokeWidth="28.0"
        strokeLinecap="butt"
      />
      <circle cx="640.0" cy="389.0" r="72.0" fill="#C9A962" />
    </svg>
  )
}

function EmblemOnDark() {
  return (
    <svg
      className="brand-on-dark"
      width="56"
      height="56"
      viewBox="229.5 232.0 821.0 821.0"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="640.0" cy="642.5" r="403.0" fill="none" stroke="#C9A962" strokeWidth="15.0" />
      <path
        d="M516.00 701.15 A251.5 251.5 0 0 1 328.50 463.90 C435.80 423.88 559.59 482.13 640.00 562.00 C757.04 678.25 778.04 873.34 640.00 971.77 C501.96 873.34 522.96 678.25 640.00 562.00 C720.41 482.13 844.20 423.88 951.50 463.90 A251.5 251.5 0 0 1 764.00 701.15"
        fill="none"
        stroke="#FAF7ED"
        strokeWidth="28.0"
        strokeLinejoin="miter"
        strokeMiterlimit="10"
        strokeLinecap="butt"
      />
      <path
        d="M569.00 715.53 A271.0 271.0 0 0 0 711.00 715.53"
        fill="none"
        stroke="#C9A962"
        strokeWidth="28.0"
        strokeLinecap="butt"
      />
      <circle cx="640.0" cy="389.0" r="72.0" fill="#C9A962" />
    </svg>
  )
}

export function Brand() {
  return (
    <div style={{ textAlign: 'center' }}>
      <span className="brand-mark-auto" style={{ margin: '24px auto 16px' }}>
        <EmblemOnLight />
        <EmblemOnDark />
      </span>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, letterSpacing: '-.3px', color: 'var(--text-primary)' }}>
        My Signet{' '}
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontWeight: 600,
            fontSize: 12,
            textTransform: 'uppercase',
            letterSpacing: '.08em',
            color: 'var(--brand-gold-text)',
          }}
        >
          Lite
        </span>
      </div>
    </div>
  )
}
