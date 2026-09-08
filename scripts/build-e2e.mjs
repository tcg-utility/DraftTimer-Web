import { spawnSync } from 'node:child_process';

const build = spawnSync(process.execPath, ['./node_modules/next/dist/bin/next', 'build'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NEXT_PUBLIC_BASE_PATH: '/DraftTimer-Web',
    NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:4173/DraftTimer-Web',
  },
});
if (build.status !== 0) process.exit(build.status ?? 1);
await import('./generate-service-worker.mjs');
