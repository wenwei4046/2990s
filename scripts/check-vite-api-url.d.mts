// Type declarations for check-vite-api-url.mjs so the TS-checked vite.config.ts
// files (tsconfig.node.json includes vite.config.ts) can import it cleanly.
export function isProdApiUrl(value: unknown): boolean;
export function assertViteApiUrl(args: {
  value: unknown;
  command: string;
  app: string;
}): void;
