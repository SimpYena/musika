import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    // Phosphor's barrel export is ~9k modules; this keeps dev compiles fast.
    optimizePackageImports: ['@phosphor-icons/react'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // YouTube returns onError 153 if we send no referrer. Do not tighten this.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },
}

export default nextConfig
