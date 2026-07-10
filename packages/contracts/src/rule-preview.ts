import { z } from "zod";

// ponytail: RED stub — filled in by the immediately-following GREEN commit.
export const previewRuleOverridesRequest = z.object({}).strict();
export type PreviewRuleOverridesRequest = z.infer<typeof previewRuleOverridesRequest>;

export const previewRuleOverridesResponse = z.object({}).strict();
export type PreviewRuleOverridesResponse = z.infer<typeof previewRuleOverridesResponse>;
