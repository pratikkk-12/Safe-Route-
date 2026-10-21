// Runs once when a Next.js server instance starts.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logRoutingConfig } = await import("@/lib/routing/provider");
    logRoutingConfig();
  }
}
