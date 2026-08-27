import type { NextConfig } from 'next';

const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const basePath = configuredBasePath === '/' ? '' : configuredBasePath.replace(/\/$/, '');
const isStaticExport = Boolean(basePath);

const nextConfig: NextConfig = {
  output: isStaticExport ? 'export' : undefined,
  trailingSlash: isStaticExport,
  basePath,
  assetPrefix: basePath || undefined,
  images: isStaticExport ? { unoptimized: true } : undefined,
};

export default nextConfig;
