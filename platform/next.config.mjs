/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Keep the headless-Chrome PDF deps OUT of the webpack bundle. @sparticuz/chromium
    // ships a packed Brotli binary + puppeteer-core uses dynamic requires; bundling
    // them breaks the launch. Marking them external makes Next trace them as raw
    // node_modules on the serverless function (the supported pattern on Vercel).
    serverComponentsExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
    // Boot-time schema-drift guard (KT #295). The hook runs once per server
    // process and probes the schema-manifest against the live DB.
    instrumentationHook: true,
  },
};

export default nextConfig;
