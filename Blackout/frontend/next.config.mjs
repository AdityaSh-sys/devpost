import withPWAInit from 'next-pwa';

const withPWA = withPWAInit({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  runtimeCaching: [
    {
      urlPattern: /^\/api\/ping/,
      handler: 'NetworkFirst',
      method: 'HEAD',
      options: {
        cacheName: 'ping-cache',
        expiration: {
          maxEntries: 1,
          maxAgeSeconds: 86400,
        },
        networkTimeoutSeconds: 5,
      },
    },
  ],
});

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default withPWA(nextConfig);
