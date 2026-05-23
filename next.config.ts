import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["india-pincode"],
  outputFileTracingIncludes: {
    "/blood/api/address/pincode/[pincode]": [
      "./node_modules/india-pincode/data/**/*",
    ],
    "/blood/api/address/postoffice": [
      "./node_modules/india-pincode/data/**/*",
    ],
  },
};

export default nextConfig;
