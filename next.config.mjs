/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'res.cloudinary.com' },
    ],
  },
  // Transpile MediaPipe packages
  transpilePackages: ['@mediapipe/selfie_segmentation'],
  // Disable Turbopack to use webpack for MediaPipe compatibility
  experimental: {
    turbo: false,
  },
  webpack: (config, { isServer }) => {
    // Handle MediaPipe modules
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }
    
    return config;
  },
};
export default nextConfig;
