// BSM kernel now lives in @morai/quant (pure leaf below core and web).
// This shim re-exports all public symbols so existing call sites in core need no changes.

export type { BsmGreeks } from "@morai/quant";
export { bsmPrice, bsmGreeks, bsmVega } from "@morai/quant";
