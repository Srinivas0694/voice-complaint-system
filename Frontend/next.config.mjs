/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // The ingest route holds a request open while Gemini transcribes (2–5 s).
    serverActions: { bodySizeLimit: '8mb' },
  },
};
export default nextConfig;
