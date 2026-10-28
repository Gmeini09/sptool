// Turbo fan from the Turbo Design emblem – used as loader and in the boot intro.
export function Turbine({ size = 48, spin = 'normal', className = '' }: { size?: number; spin?: 'normal' | 'spool' | 'idle'; className?: string }) {
  const blades = Array.from({ length: 11 }, (_, i) => i * (360 / 11));
  return (
    <svg className={`turbine turbine-${spin} ${className}`} width={size} height={size} viewBox="-50 -50 100 100" aria-hidden="true">
      <defs>
        <radialGradient id="tb-glow" r="0.5">
          <stop offset="0.55" stopColor="#1f7bff" stopOpacity="0" />
          <stop offset="0.8" stopColor="#1f7bff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#1f7bff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="tb-steel" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f2f6fc" />
          <stop offset="0.45" stopColor="#9aa6b8" />
          <stop offset="0.55" stopColor="#5d6878" />
          <stop offset="1" stopColor="#d7dfeb" />
        </linearGradient>
        <linearGradient id="tb-blade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#2a3240" />
          <stop offset="0.6" stopColor="#8d9bb0" />
          <stop offset="1" stopColor="#4aa8ff" />
        </linearGradient>
      </defs>
      <circle r="49" fill="url(#tb-glow)" />
      <circle r="44" fill="#05080e" stroke="url(#tb-steel)" strokeWidth="5" />
      <circle r="40.5" fill="none" stroke="#1f7bff" strokeWidth="1.2" opacity="0.9" />
      <g className="turbine-rotor">
        {blades.map((a) => (
          <path key={a} transform={`rotate(${a})`} d="M 7 -2 C 16 -6, 28 -10, 38 -6 C 34 -1, 22 3, 8 3 Z" fill="url(#tb-blade)" stroke="#0b0f17" strokeWidth="0.6" />
        ))}
        <circle r="9" fill="url(#tb-steel)" />
        <circle r="4" fill="#0b0f17" stroke="#4aa8ff" strokeWidth="1" />
      </g>
    </svg>
  );
}
