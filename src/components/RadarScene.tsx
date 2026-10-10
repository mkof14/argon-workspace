// Login backdrop: a live radar plot over a sea chart — the thing StarDome actually does.
export default function RadarScene() {
  const rings = [90, 180, 270, 360, 450];
  const contacts = [[118, -62, 0.4], [-150, 96, 1.6], [232, 140, 2.7], [-60, -210, 3.5], [330, -120, 4.4], [40, 300, 5.2]];
  return (
    <div className="scene" aria-hidden="true">
      <svg className="chart" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
        <defs>
          <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse"><path d="M80 0H0V80" fill="none" stroke="#6FA8C7" strokeOpacity=".07" /></pattern>
        </defs>
        <rect width="1600" height="1000" fill="url(#grid)" />
        <path d="M0 760 C180 720 260 800 420 770 C560 742 610 660 760 676 C900 690 960 780 1110 760 C1260 740 1320 650 1600 690 L1600 1000 L0 1000 Z" fill="#0E2232" opacity=".7" />
        <path d="M0 760 C180 720 260 800 420 770 C560 742 610 660 760 676 C900 690 960 780 1110 760 C1260 740 1320 650 1600 690" fill="none" stroke="#6FA8C7" strokeOpacity=".25" strokeDasharray="2 6" />
        <g transform="translate(560 470)">
          {rings.map((r) => <circle key={r} r={r} fill="none" stroke="#6FA8C7" strokeOpacity={r === 450 ? 0.22 : 0.12} />)}
          <path d="M-470 0H470M0 -470V470" stroke="#6FA8C7" strokeOpacity=".12" />
          {Array.from({ length: 72 }).map((_, i) => { const a = (i * 5 * Math.PI) / 180, r1 = i % 6 ? 444 : 432; return <line key={i} x1={Math.cos(a) * r1} y1={Math.sin(a) * r1} x2={Math.cos(a) * 450} y2={Math.sin(a) * 450} stroke="#6FA8C7" strokeOpacity=".3" />; })}
          {contacts.map(([x, y, d], i) => <g key={i} className="contact" style={{ animationDelay: `${d}s` }}><circle cx={x} cy={y} r="5" fill="#FF6A2B" /><circle cx={x} cy={y} r="12" fill="none" stroke="#FF6A2B" strokeOpacity=".6" /></g>)}
          <g className="sweepg">{Array.from({ length: 16 }).map((_, i) => { const r = 450, a0 = (-(i + 1) * 2.2 * Math.PI) / 180, a1 = (-i * 2.2 * Math.PI) / 180; return <path key={i} d={`M0 0L${r * Math.cos(a0)} ${r * Math.sin(a0)}A${r} ${r} 0 0 1 ${r * Math.cos(a1)} ${r * Math.sin(a1)}Z`} fill="#FF6A2B" fillOpacity={0.28 * Math.pow(1 - i / 16, 2)} />; })}
            <line x1="0" y1="0" x2="450" y2="0" stroke="#FF8A55" strokeOpacity=".9" strokeWidth="1.5" /></g>
          <rect x="-14" y="-9" width="28" height="18" rx="2" fill="#0B1620" stroke="#FF6A2B" />
          <path d="M-8 -9a8 8 0 0 1 16 0" fill="none" stroke="#FF6A2B" />
        </g>
      </svg>
    </div>
  );
}
