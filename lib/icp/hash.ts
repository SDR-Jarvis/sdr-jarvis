import { createHash } from "node:crypto";
import type { ICPSignals } from "@/lib/icp/parser";

/** Stable SHA-256 hex for cache keys (server-only). */
export function hashIcpSignalsSha256(signals: ICPSignals): string {
  const normalized = JSON.stringify({
    roles: [...signals.roles].sort(),
    industries: [...signals.industries].sort(),
    stage: [...signals.stage].sort(),
    company_size: signals.company_size,
    exclude: [...signals.exclude].sort(),
    geography: [...signals.geography].sort(),
  });
  return createHash("sha256").update(normalized).digest("hex");
}
