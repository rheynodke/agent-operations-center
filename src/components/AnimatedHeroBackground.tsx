import React from "react";

export function AnimatedHeroBackground() {
  return (
    <div className="relative w-full h-full bg-black overflow-hidden flex items-center justify-center">
      {/* High-tech Grid Background */}
      <div 
        className="absolute inset-0 bg-[linear-gradient(to_right,#a855f715_1px,transparent_1px),linear-gradient(to_bottom,#a855f715_1px,transparent_1px)] bg-[size:4rem_4rem]"
        style={{ 
          maskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, #000 30%, transparent 80%)', 
          WebkitMaskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, #000 30%, transparent 80%)' 
        }}
      ></div>

      {/* Dynamic ambient lights */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full mix-blend-screen filter blur-[100px] animate-pulse"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/15 rounded-full mix-blend-screen filter blur-[100px]" style={{ animation: 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite', animationDelay: '1s' }}></div>

      {/* SVG Canvas for Character Grid */}
      <svg className="relative z-10 w-full h-full min-w-[800px]" viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="neon-purple" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#c084fc" />
            <stop offset="100%" stopColor="#7e22ce" />
          </linearGradient>
          <linearGradient id="neon-blue" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#60a5fa" />
            <stop offset="100%" stopColor="#2563eb" />
          </linearGradient>
          <filter id="neon-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Central Hub / Main Agent Core */}
        <g transform="translate(500, 500)">
          {/* Rotating Rings */}
          <g style={{ animation: 'spin-bg 30s linear infinite', transformOrigin: 'center' }}>
            <circle cx="0" cy="0" r="160" fill="none" stroke="rgba(168, 85, 247, 0.4)" strokeWidth="1" strokeDasharray="4 8" />
            <circle cx="0" cy="0" r="220" fill="none" stroke="rgba(59, 130, 246, 0.3)" strokeWidth="2" strokeDasharray="20 10 5" />
          </g>
          <g style={{ animation: 'spin-bg-reverse 40s linear infinite', transformOrigin: 'center' }}>
            <circle cx="0" cy="0" r="190" fill="none" stroke="rgba(168, 85, 247, 0.2)" strokeWidth="1" strokeDasharray="100 20" />
            <circle cx="0" cy="0" r="260" fill="none" stroke="rgba(236, 72, 153, 0.15)" strokeWidth="1" strokeDasharray="10 30" />
          </g>

          {/* Central Core Brain */}
          <g style={{ animation: 'float-bg 5s ease-in-out infinite' }}>
            <circle cx="0" cy="0" r="80" fill="url(#neon-purple)" fillOpacity="0.1" stroke="url(#neon-purple)" strokeWidth="2" filter="url(#neon-glow)" />
            {/* Geometric Core */}
            <path d="M -30 -30 L 30 -30 L 50 0 L 30 30 L -30 30 L -50 0 Z" fill="rgba(168,85,247,0.3)" stroke="#c084fc" strokeWidth="2" />
            {/* Core Eye */}
            <circle cx="0" cy="0" r="15" fill="#fff" filter="url(#neon-glow)" style={{ animation: 'pulse-bg 3s infinite' }} />
          </g>
        </g>

        {/* Data Streams / Network Lines connecting to bots */}
        <g stroke="rgba(255,255,255,0.05)" strokeWidth="2" fill="none">
          <path d="M 500 500 L 250 300" strokeDasharray="5 5" style={{ animation: 'flowLines 20s linear infinite' }}/>
          <path d="M 500 500 L 750 250" strokeDasharray="5 5" style={{ animation: 'flowLines-reverse 25s linear infinite' }}/>
          <path d="M 500 500 L 250 750" strokeDasharray="5 5" style={{ animation: 'flowLines 22s linear infinite' }}/>
          <path d="M 500 500 L 750 700" strokeDasharray="5 5" style={{ animation: 'flowLines-reverse 18s linear infinite' }}/>
          <path d="M 500 500 L 120 500" strokeDasharray="5 5" style={{ animation: 'flowLines 15s linear infinite' }}/>
          <path d="M 500 500 L 880 550" strokeDasharray="5 5" style={{ animation: 'flowLines-reverse 19s linear infinite' }}/>
        </g>

        {/* Swarm of Cube Bots */}
        <g style={{ animation: 'float-bg 6s ease-in-out infinite', transformOrigin: 'center' }}>
          <CubeCharacter x={250} y={300} scale={0.8} color="#c084fc" delay="0s" text="AOC-01" />
        </g>
        
        <g style={{ animation: 'float-bg 7.5s ease-in-out infinite alternate', transformOrigin: 'center' }}>
          <CubeCharacter x={750} y={250} scale={1.1} color="#60a5fa" delay="-2s" text="AOC-02" />
        </g>

        <g style={{ animation: 'float-bg 8s ease-in-out infinite', transformOrigin: 'center' }}>
          <CubeCharacter x={250} y={750} scale={1.3} color="#f472b6" delay="-4s" text="SYNC" />
        </g>

        <g style={{ animation: 'float-bg 6.5s ease-in-out infinite alternate', transformOrigin: 'center' }}>
          <CubeCharacter x={750} y={700} scale={0.9} color="#c084fc" delay="-1s" text="AUTH" />
        </g>

        <g style={{ animation: 'float-bg 9s ease-in-out infinite', transformOrigin: 'center' }}>
          <CubeCharacter x={120} y={500} scale={0.5} color="#34d399" delay="-3s" text="NODE" />
        </g>
        
        {/* Floating Code Particles */}
        <g className="text-[#c084fc] opacity-40 font-mono text-xs" style={{ animation: 'float-bg 12s linear infinite' }}>
          <text x="350" y="200">{"<initialize_sequence>"}</text>
          <text x="600" y="800">{"[status: online]"}</text>
          <text x="200" y="600">{"system.run()"}</text>
          <text x="800" y="400">{"await connect()"}</text>
        </g>

      </svg>
      
      {/* Styles for complex SVG animations */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes float-bg {
          0% { transform: translateY(0px); }
          50% { transform: translateY(-20px); }
          100% { transform: translateY(0px); }
        }
        @keyframes spin-bg {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes spin-bg-reverse {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }
        @keyframes pulse-bg {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(0.9); }
        }
        @keyframes flowLines {
          from { stroke-dashoffset: 100; }
          to { stroke-dashoffset: 0; }
        }
        @keyframes flowLines-reverse {
          from { stroke-dashoffset: 0; }
          to { stroke-dashoffset: 100; }
        }
      `}} />
    </div>
  );
}

function CubeCharacter({ x, y, scale, color, delay, text }: { x: number, y: number, scale: number, color: string, delay: string, text: string }) {
  return (
    <g transform={`translate(${x}, ${y}) scale(${scale})`}>
      {/* Outer Hologram Shield */}
      <circle cx="0" cy="0" r="75" fill="none" stroke={color} strokeWidth="1" strokeDasharray="5 5" strokeOpacity="0.3" style={{ animation: 'spin-bg 15s linear infinite', transformOrigin: 'center' }} />
      <circle cx="0" cy="0" r="90" fill="none" stroke={color} strokeWidth="0.5" strokeOpacity="0.1" />
      
      {/* Target Crosshair / Details */}
      <path d="M -90 0 L -80 0 M 90 0 L 80 0 M 0 -90 L 0 -80 M 0 90 L 0 80" stroke={color} strokeWidth="1" strokeOpacity="0.5" />
      
      {/* Floating base rings under the bot */}
      <g style={{ animation: 'float-bg 4s ease-in-out infinite', animationDelay: delay }}>
        <ellipse cx="0" cy="50" rx="35" ry="12" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="3 4" strokeOpacity="0.6" style={{ animation: 'spin-bg 5s linear infinite', transformOrigin: '0 50px' }} />
      </g>

      {/* The Cube Body (Isometric) */}
      <g style={{ animation: 'float-bg 5s ease-in-out infinite', animationDelay: delay }}>
        {/* Top Face */}
        <path d="M 0 -35 L 45 -15 L 0 5 L -45 -15 Z" fill={color} fillOpacity="0.25" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        {/* Left Face */}
        <path d="M -45 -15 L 0 5 L 0 55 L -45 35 Z" fill={color} fillOpacity="0.1" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        {/* Right Face */}
        <path d="M 0 5 L 45 -15 L 45 35 L 0 55 Z" fill={color} fillOpacity="0.15" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        
        {/* Face Display Screen (Left Side Isometric) */}
        <path d="M -38 -8 L -6 5 L -6 40 L -38 28 Z" fill="#050510" fillOpacity="0.8" />
        
        {/* Bot Eye (Glowing on display) */}
        <circle cx="-22" cy="16" r="6" fill="#fff" filter="url(#neon-glow)" style={{ animation: 'pulse-bg 2s infinite', animationDelay: delay }} />
        <circle cx="-22" cy="16" r="3" fill={color} />
        
        <rect x="-33" y="2" width="6" height="4" fill={color} fillOpacity="0.5" transform="rotate(20 -33 2)" />
        <rect x="-12" y="22" width="4" height="4" fill={color} fillOpacity="0.5" transform="rotate(20 -12 22)" />

        {/* Right Side Tech Detail */}
        <path d="M 12 5 L 35 -5 L 35 15 L 12 25 Z" fill={color} fillOpacity="0.3" />
        <circle cx="22" cy="10" r="3" fill="#fff" fillOpacity="0.4" />
        <circle cx="30" cy="5" r="1.5" fill="#fff" fillOpacity="0.6" />
        <circle cx="16" cy="18" r="1.5" fill="#fff" fillOpacity="0.6" />
        
        {/* Antenna */}
        <path d="M 0 -35 L 0 -55" stroke={color} strokeWidth="2" strokeLinecap="round" />
        <circle cx="0" cy="-55" r="4" fill="#fff" filter="url(#neon-glow)" style={{ animation: 'pulse-bg 1.5s infinite', animationDelay: delay }} />
        <path d="M 0 -45 L 8 -48" stroke={color} strokeWidth="1" strokeLinecap="round" />

        {/* Floating ID Tag */}
        <g transform="translate(45, -25)">
          <path d="M 0 0 L 15 -10 L 45 -10 L 45 6 L 15 6 Z" fill={color} fillOpacity="0.1" stroke={color} strokeWidth="0.5" />
          <text x="18" y="0" fill="#fff" fontSize="8" fontFamily="monospace" fontWeight="bold" fillOpacity="0.8">{text}</text>
        </g>
      </g>
    </g>
  );
}
