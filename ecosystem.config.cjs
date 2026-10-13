const path = require('path');

module.exports = {
  apps: [
    {
      name: 'mecal-api',
      cwd: __dirname,
      script: path.join('src', 'server.js'),
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '800M',
      min_uptime: '10s',
      max_restarts: 40,
      exp_backoff_restart_delay: 1000,
      kill_timeout: 8000,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
