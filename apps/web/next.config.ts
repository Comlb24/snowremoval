import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@snow/core', '@snow/server'],
  serverExternalPackages: ['@electric-sql/pglite', 'twilio', 'postgres'],
  poweredByHeader: false,
};

export default nextConfig;
