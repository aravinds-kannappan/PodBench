/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // alasql ships a CommonJS build that Next tries to bundle for the server.
  // Mark it external so the serverless function loads it at runtime instead.
  serverExternalPackages: ["alasql"],
  // Keep the data files reachable from serverless functions on Vercel.
  outputFileTracingIncludes: {
    "/api/**": ["./data/**"],
  },
};

export default nextConfig;
