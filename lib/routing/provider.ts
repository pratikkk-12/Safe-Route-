import { orsProvider } from "./ors";
import { osrmProvider } from "./osrm";
import type { RoutingProvider } from "./types";

export interface ProviderChoice {
  provider: RoutingProvider;
  /** Set when the configured provider can't be used. */
  warning?: string;
}

/** ROUTING_PROVIDER=osrm (default) | ors. ors without ORS_API_KEY falls back to osrm. */
export function chooseProvider(env: Record<string, string | undefined> = process.env): ProviderChoice {
  const wanted = (env.ROUTING_PROVIDER ?? "osrm").trim().toLowerCase() || "osrm";
  if (wanted === "ors") {
    if (env.ORS_API_KEY?.trim()) return { provider: orsProvider };
    return {
      provider: osrmProvider,
      warning: "ROUTING_PROVIDER=ors but ORS_API_KEY is not set; using OSRM (routing.openstreetmap.de) instead.",
    };
  }
  if (wanted !== "osrm") {
    return { provider: osrmProvider, warning: `Unknown ROUTING_PROVIDER "${wanted}"; using OSRM.` };
  }
  return { provider: osrmProvider };
}

let chosen: ProviderChoice | null = null;

/** The provider for this server process. Any warning is logged once, at startup (instrumentation.ts). */
export function getProvider(): RoutingProvider {
  chosen ??= chooseProvider();
  return chosen.provider;
}

export function logRoutingConfig() {
  chosen ??= chooseProvider();
  if (chosen.warning) console.warn(`[routing] ${chosen.warning}`);
}
