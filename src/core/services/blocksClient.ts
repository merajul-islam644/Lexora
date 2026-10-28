import { createBlocksClient, type BlocksClient } from "@seliseblocks/client";
import { blocksConfigured, env } from "../env.js";

/* Server-side Blocks Data Gateway client (machine-to-machine).

   Authenticates with the project's machine-to-machine client credential
   ("lexora-server", System User role). The token is cached until a minute
   before it expires; the SDK sends it on every call. Only the scripts and
   the sqliteStore-based tests use this client -- the deployed function and
   the SPA go through the caller's own token instead. Rows key users by
   lowercase email (IAM is the only identity); see
   scripts/migrate-identity-to-emails.mts. */

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cached: CachedToken | null = null;
let client: BlocksClient | null = null;

async function accessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  if (!blocksConfigured()) throw new Error("Blocks client credentials are not configured (LEXORA_BLOCKS_CLIENT_ID / LEXORA_BLOCKS_CLIENT_SECRET).");
  const authClient = createBlocksClient({
    apiUrl: env.blocksApiUrl,
    xBlocksKey: env.blocksKey
  }).auth;
  const res = await authClient.oidc.clientCredentials({
    clientId: env.blocksClientId,
    clientSecret: env.blocksClientSecret
  });
  const token = res.accessToken ?? res.access_token;
  if (!token) throw new Error("Blocks client-credentials grant returned no access token.");
  const expiresIn = Number(res.expiresIn ?? res.expires_in ?? 3600);
  cached = { token, expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000 };
  return token;
}

/** Shared SDK client. Throws when credentials are missing -- callers should
 * gate on blocksConfigured()/useBlocksStore() before reaching here. */
export function getBlocksClient(): BlocksClient {
  if (!client) {
    client = createBlocksClient({
      apiUrl: env.blocksApiUrl,
      xBlocksKey: env.blocksKey,
      accessToken: () => accessToken()
    });
  }
  return client;
}
