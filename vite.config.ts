import fs from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/* VITE_BLOCKS_DEV_HOST: set this in .env to the project's real domain
   (dirion.slsblx.com) so Blocks hosted login works locally -- the SSO
   session cookie is Secure and domain-scoped, so browsers refuse it on
   plain http://localhost. Run `npm run cert` once it's set. */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const domain = env.VITE_BLOCKS_DEV_HOST || undefined;
  const port = Number(env.VITE_BLOCKS_DEV_PORT || 5173);
  const https = fs.existsSync(".cert/dev-key.pem") && fs.existsSync(".cert/dev-cert.pem")
    ? { key: fs.readFileSync(".cert/dev-key.pem"), cert: fs.readFileSync(".cert/dev-cert.pem") }
    : undefined;

  return {
    root: ".",
    plugins: [react()],
    build: {
      outDir: "dist-web",
      emptyOutDir: true
    },
    server: {
      // Vite blocks unrecognized Host headers by default (DNS-rebinding
      // protection) -- without this the custom domain 404s with "Blocked
      // request. This host is not allowed" even once hosts + cert are set.
      // Bind every interface and gate by Host header instead: the scaffold's
      // `host: domain` DNS-resolves the domain, which points at the platform's
      // real IP until the hosts entry maps it to 127.0.0.1 -- binding fails
      // with EADDRNOTAVAIL before that line exists.
      allowedHosts: domain ? [domain, "localhost"] : undefined,
      host: "0.0.0.0",
      https,
      port,
      // Keep the port fixed: it's part of the registered OIDC redirect_uri.
      strictPort: true
    }
  };
});
