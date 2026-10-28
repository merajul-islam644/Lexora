/* Server-side env (shared by the function bundle and the scripts): Blocks
   gateway credentials for the machine-to-machine client, and the optional
   AI key the generator provider uses. The web bundle does NOT read this --
   the browser config lives in src/web/lib/blocks/config.ts, and the deployed
   function gets its values baked in by scripts/build-function.mjs. */

const read = (key: string): string => process.env[key]?.trim() ?? "";

export const env = {
  blocksApiUrl: read("VITE_BLOCKS_API_URL") || "https://blocksapi.slsblx.com",
  blocksKey: read("VITE_BLOCKS_X_BLOCKS_KEY"),
  blocksClientId: read("LEXORA_BLOCKS_CLIENT_ID"),
  blocksClientSecret: read("LEXORA_BLOCKS_CLIENT_SECRET"),
  aiApiKey: read("LEXORA_AI_API_KEY"),
  aiProvider: read("LEXORA_AI_PROVIDER")
};

export function blocksConfigured(): boolean {
  return Boolean(env.blocksApiUrl && env.blocksKey && env.blocksClientId && env.blocksClientSecret);
}
