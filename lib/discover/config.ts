export const ENABLE_APOLLO_DISCOVERY_ENV = "ENABLE_APOLLO_DISCOVERY";

export function isApolloDiscoveryEnabled(): boolean {
  return process.env[ENABLE_APOLLO_DISCOVERY_ENV]?.trim().toLowerCase() === "true";
}

export function getApolloDiscoveryKey(): string | null {
  if (!isApolloDiscoveryEnabled()) return null;
  return process.env.APOLLO_API_KEY?.trim() || null;
}
