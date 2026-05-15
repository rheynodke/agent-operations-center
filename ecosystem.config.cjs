module.exports = {
  apps: [
    {
      name: 'aoc-dashboard',
      script: 'server/index.cjs',
      cwd: __dirname,
      // Bumped from 512MB to 1536MB: AOC's in-memory state (watchers, gateway
      // tracking, mission rooms, embed sessions) grows past 500MB within a
      // few hours of normal use. The previous setting caused pm2 to auto-
      // restart 3-5x/day, and every restart cascade-killed detached per-user
      // gateways via treekill (see notes below).
      node_args: '--max-old-space-size=1536',
      env_file: '.env',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
      // Same reason as node_args bump. Set generously high so day-to-day
      // RAM growth never triggers a restart cascade. Real OOM would still
      // get caught by Node V8 itself.
      max_memory_restart: '2G',
      // CRITICAL for production gateway stability: AOC spawns detached
      // openclaw-gateway children (one per user) that MUST survive across
      // AOC restarts. pm2's default `treekill:true` sends SIGKILL to the
      // whole process tree on stop, defeating the `detached:true` flag and
      // turning every AOC restart into a mass-stale event. Disabling sends
      // signals only to the AOC process; detached children survive.
      treekill: false,
      // Default 1.6s is too short for graceful shutdown (server.close(),
      // watcher cleanup, embed-rate-limit persist, orchestrator state flush
      // each take a few seconds when busy). Give AOC enough headroom to
      // exit cleanly before pm2 falls back to SIGKILL.
      kill_timeout: 30000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/aoc-error.log',
      out_file: 'logs/aoc-out.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
