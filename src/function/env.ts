/* Build-time configuration for the lexora-api Blocks Function. The same
   VITE_* vars the SPA uses are baked into the bundle by esbuild's define
   (see scripts/build-function.mjs). */
export const env = {
  apiUrl: process.env.VITE_BLOCKS_API_URL ?? "",
  xBlocksKey: process.env.VITE_BLOCKS_X_BLOCKS_KEY ?? ""
};
