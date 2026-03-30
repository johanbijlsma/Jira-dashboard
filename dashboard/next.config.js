const backendInternalBase = (process.env.BACKEND_INTERNAL_BASE || "http://127.0.0.1:8000").replace(/\/+$/, "");

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: [
    "localhost",
    "localhost:3000",
    "127.0.0.1",
    "127.0.0.1:3000",
    "100.108.229.18",
    "100.108.229.18:3000",
    "johans-macbook-air.tail920595.ts.net",
    "johans-macbook-air.tail920595.ts.net:3000",
    "[::1]",
    "[::1]:3000",
    "http://localhost",
    "http://localhost:3000",
    "http://127.0.0.1",
    "http://127.0.0.1:3000",
    "http://100.108.229.18",
    "http://100.108.229.18:3000",
    "http://johans-macbook-air.tail920595.ts.net",
    "http://johans-macbook-air.tail920595.ts.net:3000",
    "http://[::1]",
    "http://[::1]:3000",
  ],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendInternalBase}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
