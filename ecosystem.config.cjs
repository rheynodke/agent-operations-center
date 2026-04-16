module.exports = {
  apps: [
    {
      name: 'aoc-dashboard',
      script: 'server/index.cjs',
      cwd: __dirname,
      node_args: '--max-old-space-size=512',
      env_file: '.env',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
      max_memory_restart: '500M',
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
