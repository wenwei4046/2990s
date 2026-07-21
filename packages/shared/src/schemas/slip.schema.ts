import { z } from 'zod';

export const ALLOWED_SLIP_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const MAX_SLIP_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const HEX64 = /^[a-f0-9]{64}$/;

export const SlipInitRequestSchema = z.object({
  fileSize: z.number().int().positive().max(MAX_SLIP_SIZE_BYTES),
  contentType: z.enum(ALLOWED_SLIP_MIMES),
  contentHash: z.string().regex(HEX64, 'must be 64 lowercase hex chars (sha256)'),
  orderDraftId: z.string().min(1).max(64).optional(),
});

// 2026-07-22 aligned to Houzs: Worker-proxy upload (routes/slips.ts on Houzs),
// so init returns NO presigned putUrl — bytes go via POST /slips/:session/upload
// as raw binary. `putUrl` + `expiresAt` are OPTIONAL so a Houzs response
// (uploadSessionId + r2Key only) still type-checks; the legacy 2990 branch in
// apps/pos/src/lib/slip.ts + apps/backend/src/lib/slip.ts guards on
// `.putUrl` being present.
export const SlipInitResponseSchema = z.object({
  uploadSessionId: z.string().uuid(),
  r2Key: z.string(),
  putUrl: z.string().url().optional(),
  expiresAt: z.string().optional(),
});

export const SlipConfirmRequestSchema = z.object({}).strict();

export const SlipConfirmResponseSchema = z.object({
  status: z.literal('uploaded'),
  r2Key: z.string(),
});

// Houzs streams the slip bytes through the Worker; the "url" is an
// object-URL wrapper the client makes locally (not a real HTTP URL).
export const SlipUrlResponseSchema = z.object({
  url: z.string(),
  contentType: z.string(),
  expiresAt: z.string().optional(),
});

export type SlipInitRequest = z.infer<typeof SlipInitRequestSchema>;
export type SlipInitResponse = z.infer<typeof SlipInitResponseSchema>;
export type SlipConfirmResponse = z.infer<typeof SlipConfirmResponseSchema>;
export type SlipUrlResponse = z.infer<typeof SlipUrlResponseSchema>;
