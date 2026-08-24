import dns from "node:dns";

/**
 * Studio sits behind Cloudflare on both stacks and its AAAA addresses time out.
 * Node tries IPv6 first, so every server-side read burns ten seconds before
 * falling back - which presents as "the RPC is flaky" and, on pages that fall
 * back to seeded data, as a site that quietly stopped being live.
 *
 * This has to live in the config because the config is the first thing Next
 * evaluates. Setting it inside a route is already too late for the reads that
 * route triggers.
 */
dns.setDefaultResultOrder("ipv4first");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Vercel exposes the production domain to the server only, and this module
  // runs at build time. Copying it into a NEXT_PUBLIC_ name here is what lets
  // lib/chain.ts resolve a correct absolute origin inside client components on
  // a first deploy with nothing configured.
  env: {
    NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL:
      process.env.VERCEL_PROJECT_PRODUCTION_URL || "",
  },
};

export default nextConfig;
