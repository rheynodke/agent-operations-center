/**
 * AgentLogo — Hub/Network Node Icon
 *
 * Central hub icon with radiating connection nodes.
 * Theme-aware: uses CSS variables from --logo-* tokens
 * for proper light/dark mode rendering.
 */
export function AgentLogo({ className = "" }: { className?: string }) {
  const angles = [0, 60, 120, 180, 240, 300]
  const nodes = angles.map((angle) => {
    const rad = (angle * Math.PI) / 180
    return { x: 60 + Math.cos(rad) * 32, y: 60 + Math.sin(rad) * 32 }
  })

  return (
    <div className={className}>
      <svg
        viewBox="0 0 120 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: "100%", height: "100%" }}
      >
        {/* Background rounded square */}
        <rect
          x="4" y="4" width="112" height="112" rx="26"
          style={{ fill: "var(--logo-bg-to)", stroke: "var(--logo-bg-stroke)" }}
          strokeWidth="1"
        />
        {/* Slightly lighter inner fill for depth */}
        <rect
          x="4" y="4" width="112" height="112" rx="26"
          style={{ fill: "var(--logo-bg-from)" }}
          opacity="0.5"
        />

        {/* Ambient glow behind center */}
        <circle cx="60" cy="60" r="24" style={{ fill: "var(--logo-glow)" }} />

        {/* Connection lines */}
        {nodes.map((node, i) => (
          <line
            key={i}
            x1="60" y1="60"
            x2={node.x} y2={node.y}
            style={{ stroke: "var(--logo-line)" }}
            strokeWidth="2.5"
            strokeOpacity="0.55"
            strokeLinecap="round"
          />
        ))}

        {/* Outer nodes */}
        {nodes.map((node, i) => (
          <circle
            key={i}
            cx={node.x} cy={node.y} r="8"
            style={{ fill: "var(--logo-node)" }}
          />
        ))}

        {/* Center hub node */}
        <circle cx="60" cy="60" r="13" style={{ fill: "var(--logo-center)" }} />
        {/* Center highlight dot */}
        <circle cx="60" cy="60" r="5" style={{ fill: "var(--logo-center-to)" }} opacity="0.4" />
      </svg>
    </div>
  )
}
