// `next dev` evaluates modules with eval(); production builds don't, so 'unsafe-eval' is only allowed in development.
const scriptSrc = process.env.NODE_ENV === "production" ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    externalDir: true
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        {
          key: "Content-Security-Policy",
          value: `default-src 'self'; base-uri 'self'; frame-ancestors 'none'; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; form-action 'self'; object-src 'none'; img-src 'self' data: https:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; ${scriptSrc}; connect-src 'self' https:; upgrade-insecure-requests`
        },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" }
      ]
    }];
  }
};

export default nextConfig;
