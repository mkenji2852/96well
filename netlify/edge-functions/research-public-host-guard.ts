interface NetlifyEdgeEnv {
  get(key: string): string | undefined;
}

declare const Netlify: { env?: NetlifyEdgeEnv } | undefined;

export interface ResearchPublicHostGuardEnv {
  NODE_ENV?: string;
  RESEARCH_PUBLIC_MODE?: string;
  RESEARCH_PUBLIC_ALLOWED_HOSTS?: string;
}

export type ResearchPublicHostGuardDecision =
  | { action: "pass" }
  | { action: "reject"; status: 403; reason: "CONFIG_MISSING" | "HOST_FORBIDDEN" };

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeHost(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end >= 0 ? trimmed.slice(1, end) : trimmed;
  }
  return trimmed.split(":")[0] ?? "";
}

function requestHosts(request: Request): string[] {
  const hosts = new Set<string>();
  hosts.add(normalizeHost(new URL(request.url).hostname));

  const hostHeader = request.headers.get("host");
  if (hostHeader) hosts.add(normalizeHost(hostHeader));

  return Array.from(hosts).filter(Boolean);
}

function isResearchPublicProduction(env: ResearchPublicHostGuardEnv): boolean {
  return env.RESEARCH_PUBLIC_MODE === "true" && env.NODE_ENV === "production";
}

export function evaluateResearchPublicHostGuard(
  request: Request,
  env: ResearchPublicHostGuardEnv,
): ResearchPublicHostGuardDecision {
  if (!isResearchPublicProduction(env)) return { action: "pass" };

  const allowedHosts = splitList(env.RESEARCH_PUBLIC_ALLOWED_HOSTS).map(normalizeHost).filter(Boolean);
  if (allowedHosts.length === 0) {
    return { action: "reject", status: 403, reason: "CONFIG_MISSING" };
  }

  const hosts = requestHosts(request);
  if (hosts.length === 0 || hosts.some((host) => !allowedHosts.includes(host))) {
    return { action: "reject", status: 403, reason: "HOST_FORBIDDEN" };
  }

  return { action: "pass" };
}

function edgeEnv(): ResearchPublicHostGuardEnv {
  const getter = typeof Netlify !== "undefined" ? Netlify.env?.get.bind(Netlify.env) : undefined;
  return {
    NODE_ENV: getter?.("NODE_ENV"),
    RESEARCH_PUBLIC_MODE: getter?.("RESEARCH_PUBLIC_MODE"),
    RESEARCH_PUBLIC_ALLOWED_HOSTS: getter?.("RESEARCH_PUBLIC_ALLOWED_HOSTS"),
  };
}

function forbiddenResponse(): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: "FORBIDDEN",
        message: "Access is restricted to authorized research users.",
      },
    }),
    {
      status: 403,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "private, no-store",
      },
    },
  );
}

export default function researchPublicHostGuard(request: Request): Response | undefined {
  const decision = evaluateResearchPublicHostGuard(request, edgeEnv());
  if (decision.action === "reject") {
    return forbiddenResponse();
  }
  return undefined;
}
