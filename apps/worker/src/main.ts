// Composition root — worker.
// Boot-time: parse config → run migrator → idle (no pg-boss jobs this phase).
// Full wiring lands in plans 04/05.
import { isOk, type Result } from "@morai/core";

// Prove cross-package import chain: apps/worker → @morai/core → @morai/shared
const _noop = (r: Result<unknown, unknown>): boolean => isOk(r);
void _noop;

console.warn("morai worker scaffold loaded");
