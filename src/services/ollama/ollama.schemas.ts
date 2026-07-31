import { z } from "zod";

const modelDetailsSchema = z
  .object({
    family: z.string().optional(),
    families: z.array(z.string()).optional(),
    parameter_size: z.string().optional(),
    quantization_level: z.string().optional(),
  })
  .loose();

export const versionResponseSchema = z.object({
  version: z.string(),
});

/**
 * Keeps each external entry as unknown so callers can retain valid siblings
 * while reporting invalid entries individually through modelSummarySchema.
 */
export const tagsResponseSchema = z.object({
  models: z.array(z.unknown()),
});

export const modelSummarySchema = z.object({
  name: z.string().min(1),
  model: z.string().min(1),
  modified_at: z.string().optional(),
  size: z.number().nonnegative().optional(),
  digest: z.string().optional(),
  details: modelDetailsSchema.optional(),
});

export const showResponseSchema = z.object({
  capabilities: z.array(z.string()).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  model_info: z.record(z.string(), z.unknown()).optional(),
});

export const chatResponseSchema = z.object({
  message: z.object({
    role: z.string(),
    content: z.string(),
  }),
  done: z.boolean(),
});

export const multipartTranscriptionResponseSchema = z.object({
  text: z.string(),
});

export const topLevelErrorResponseSchema = z.object({
  error: z.string().min(1),
});
