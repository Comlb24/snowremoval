/**
 * A snowplow truck that drives along the bottom of the sign-in sky.
 * The cleared road is attached behind the truck, so the road opens up exactly where the blade has passed.
 * Animations live in globals.css (plow-*), and stop when the user prefers less motion.
 */
function Wheel({ cx }: { cx: number }) {
  return (
    <g>
      <circle cx={cx} cy={80} r={12} fill="#111827" />
      <g className="plow-wheel">
        <circle cx={cx} cy={80} r={6} fill="#9ca3af" />
        <path d={`M${cx - 6} 80h12M${cx} 74v12`} stroke="#4b5563" strokeWidth={1.6} />
      </g>
    </g>
  );
}

function Truck() {
  return (
    <svg viewBox="0 0 230 100" className="relative block w-full overflow-visible" aria-hidden>
      <defs>
        <linearGradient id="plow-beam" x1="0" x2="1">
          <stop offset="0" stopColor="#fef9c3" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fef9c3" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Headlight beam */}
      <path d="M164 55 L232 44 L232 82 Z" fill="url(#plow-beam)" />
      {/* Dump box with salt */}
      <rect x="8" y="36" width="90" height="36" rx="3" fill="#c2410c" />
      <path d="M12 36 q20 -9 42 -4 q22 -6 40 4z" fill="#e2e8f0" />
      <path d="M30 40v28M52 40v28M74 40v28" stroke="#9a3412" strokeWidth="2" />
      {/* Chassis */}
      <rect x="6" y="70" width="158" height="8" rx="2" fill="#1f2937" />
      {/* Cab and hood */}
      <rect x="102" y="30" width="44" height="42" rx="6" fill="#f97316" />
      <rect x="138" y="47" width="26" height="25" rx="4" fill="#f97316" />
      <path d="M110 36h26a3 3 0 0 1 3 3v13h-32v-13a3 3 0 0 1 3-3z" fill="#bfdbfe" opacity="0.9" />
      <rect x="106" y="58" width="10" height="2" rx="1" fill="#9a3412" />
      <circle cx="162" cy="55" r="3" fill="#fef9c3" />
      {/* Roof beacon */}
      <rect x="114" y="25" width="18" height="5" rx="2" fill="#78350f" />
      <rect className="plow-beacon" x="116" y="22" width="14" height="5" rx="2" fill="#fbbf24" />
      {/* Snow on the roof */}
      <path d="M103 31 q10 -5 21 -2 q12 -3 21 2z" fill="#f8fafc" />
      {/* Plow arm and blade */}
      <rect x="160" y="66" width="18" height="6" rx="2" fill="#374151" />
      <path d="M176 50 Q190 70 181 91 L194 91 Q202 70 190 50 Z" fill="#facc15" stroke="#a16207" strokeWidth="1.5" />
      <path d="M182 56 Q192 70 185 86" stroke="#a16207" strokeWidth="1.2" fill="none" opacity="0.6" />
      {/* Snow pushed by the blade */}
      <path d="M190 91 q2 -16 14 -14 q12 -2 14 14z" fill="#f8fafc" stroke="#b9cbe6" strokeWidth="1.2" />
      <g fill="#ffffff" stroke="#c7d7ee" strokeWidth="0.6">
        <circle className="plow-spray" cx="200" cy="78" r="3" />
        <circle className="plow-spray" cx="206" cy="80" r="2.2" style={{ animationDelay: '-0.3s' }} />
        <circle className="plow-spray" cx="196" cy="76" r="2.6" style={{ animationDelay: '-0.6s' }} />
        <circle className="plow-spray" cx="210" cy="82" r="1.8" style={{ animationDelay: '-0.45s' }} />
        <circle className="plow-spray" cx="203" cy="74" r="1.6" style={{ animationDelay: '-0.15s' }} />
      </g>
      <Wheel cx={38} />
      <Wheel cx={70} />
      <Wheel cx={134} />
    </svg>
  );
}

export function PlowScene() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 bottom-0 -z-10 h-28 overflow-hidden sm:h-32">
      {/* Snow-covered road */}
      <div className="absolute inset-x-0 bottom-0 h-5 border-t-2 border-[#cddcf1] bg-[linear-gradient(180deg,#ffffff_0%,#dfe9f8_100%)] shadow-[0_-4px_10px_rgba(120,150,200,0.25)] sm:h-6" />
      <div className="plow-drive absolute bottom-1.5 left-0 w-[170px] sm:w-[230px]">
        {/* Cleared road behind the blade */}
        <div className="plow-trail absolute -bottom-1.5 right-[14%] h-5 w-[130vw] border-t-[3px] border-white/90 bg-[repeating-linear-gradient(90deg,#3d4c66_0_38px,#43536f_38px_76px)] sm:h-6" />
        <Truck />
      </div>
    </div>
  );
}
