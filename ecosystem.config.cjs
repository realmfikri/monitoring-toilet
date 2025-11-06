module.exports = {
  apps: [
    {
      name: 'toilet-api',
      script: 'dist/server.js',
      cwd: '/opt/toilet/backend',
      env_file: '/opt/toilet/backend/.env.production',
      env: {
        NODE_ENV: 'production'
      },
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false
    },
    {
      name: 'toilet-api-dev',
      script: 'dist/server.js',
      cwd: '/opt/toilet/backend',
      env_file: '/opt/toilet/backend/.env.development',
      env: {
        NODE_ENV: 'development',
        PORT: 3300
      },
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false
    },
    {
      name: 'toilet-app',
      script: '/usr/bin/serve',
      args: ['-s', '.', '-l', 'tcp://0.0.0.0:4173'],
      cwd: '/opt/toilet/frontend/dist',
      env: {
        NODE_ENV: 'production'
      },
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false
    },
    {
      name: 'toilet-app-dev',
      script: 'npm',
      args: 'run dev -- --host --port 5173',
      cwd: '/opt/toilet/frontend',
      env_file: '/opt/toilet/frontend/.env.development',
      env: {
        NODE_ENV: 'development'
      },
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false
    }
  ]
};
