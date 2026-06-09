import { createHmac, timingSafeEqual } from "node:crypto";
import {
  bearerTokenAuth,
  defaultAccessContext,
  type AccessContext,
  type AuthRequest,
  type AuthResult,
  type IdentityAlias,
  type IdentityProvider,
  type Principal,
} from "./auth-gateway.js";

export type NormalizedClaims = {
  subject: string;
  provider: string;
  groups?: readonly string[];
  roles?: readonly string[];
  scopes?: readonly string[];
  tenantId?: string;
  organizationId?: string;
  email?: string;
  username?: string;
  displayName?: string;
};

export type ClaimNormalizer = (rawClaims: Record<string, unknown>) => NormalizedClaims;

export type AuthProviderAdapterOptions = {
  providerName: string;
  normalize: ClaimNormalizer;
  principalIdPrefix?: string;
};

export type AuthProviderAdapter = {
  providerName: string;
  normalize: ClaimNormalizer;
  createIdentityProvider(verify: (token: string) => Promise<Record<string, unknown> | null>): IdentityProvider;
  claimsToPrincipal(claims: Record<string, unknown>): Principal;
};

export function createAuthProviderAdapter(options: AuthProviderAdapterOptions): AuthProviderAdapter {
  const prefix = options.principalIdPrefix ?? `${options.providerName}:`;

  return {
    providerName: options.providerName,
    normalize: options.normalize,
    claimsToPrincipal(rawClaims: Record<string, unknown>): Principal {
      const normalized = options.normalize(rawClaims);
      const aliases: IdentityAlias[] = [{ provider: normalized.provider, subject: normalized.subject }];
      if (normalized.email) {
        aliases.push({ provider: "email", subject: normalized.email });
      }
      if (normalized.username) {
        aliases.push({ provider: "username", subject: normalized.username });
      }
      return {
        id: `${prefix}${normalized.subject}`,
        provider: normalized.provider,
        aliases,
        groups: normalized.groups ? [...normalized.groups] : [],
        roles: normalized.roles ? [...normalized.roles] : undefined,
        scopes: normalized.scopes ? [...normalized.scopes] : undefined,
        tenantId: normalized.tenantId,
        organizationId: normalized.organizationId,
        displayName: normalized.displayName,
      };
    },
    createIdentityProvider(
      verify: (token: string) => Promise<Record<string, unknown> | null>,
    ): IdentityProvider {
      const adapter = this;
      return bearerTokenAuth({
        source: options.providerName,
        async verify(token: string) {
          const rawClaims = await verify(token);
          if (!rawClaims) {
            return null;
          }
          return adapter.claimsToPrincipal(rawClaims);
        },
      });
    },
  };
}

export type JwtAuthOptions = {
  secret: string;
  algorithm?: "HS256";
  issuer?: string;
  audience?: string;
  normalize?: ClaimNormalizer;
  providerName?: string;
};

type JwtHeader = {
  alg: string;
  typ?: string;
};

type JwtPayload = Record<string, unknown>;

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  const base64 = pad ? padded + "=".repeat(4 - pad) : padded;
  return Buffer.from(base64, "base64");
}

function base64UrlEncode(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function parseJwtSections(token: string): { header: JwtHeader; payload: JwtPayload; signingInput: string; signaturePart: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [headerPart, payloadPart, signaturePart] = [parts[0], parts[1], parts[2]];
  if (!headerPart || !payloadPart || !signaturePart) {
    return null;
  }
  try {
    const header = JSON.parse(base64UrlDecode(headerPart).toString("utf8")) as JwtHeader;
    const payload = JSON.parse(base64UrlDecode(payloadPart).toString("utf8")) as JwtPayload;
    return { header, payload, signingInput: `${headerPart}.${payloadPart}`, signaturePart };
  } catch {
    return null;
  }
}

function verifyHs256(signingInput: string, signaturePart: string, secret: string): boolean {
  const expected = base64UrlEncode(
    createHmac("sha256", secret).update(signingInput).digest(),
  );
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signaturePart);
  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, actualBuf);
}

function defaultJwtNormalizer(rawClaims: Record<string, unknown>): NormalizedClaims {
  const subject = String(rawClaims["sub"] ?? "");
  const groups = extractStringArray(rawClaims["groups"]);
  const roles = extractStringArray(rawClaims["roles"]);
  const scopes = typeof rawClaims["scope"] === "string"
    ? rawClaims["scope"].split(" ").filter((s: string) => s.length > 0)
    : extractStringArray(rawClaims["scopes"]);
  return {
    subject,
    provider: String(rawClaims["iss"] ?? "jwt"),
    groups,
    roles,
    scopes,
    tenantId: rawClaims["tid"] ? String(rawClaims["tid"]) : rawClaims["tenant_id"] ? String(rawClaims["tenant_id"]) : undefined,
    organizationId: rawClaims["org_id"] ? String(rawClaims["org_id"]) : rawClaims["organization_id"] ? String(rawClaims["organization_id"]) : undefined,
    email: rawClaims["email"] ? String(rawClaims["email"]) : undefined,
    username: rawClaims["preferred_username"] ? String(rawClaims["preferred_username"]) : rawClaims["username"] ? String(rawClaims["username"]) : undefined,
    displayName: rawClaims["name"] ? String(rawClaims["name"]) : undefined,
  };
}

function extractStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function jwtAuth(options: JwtAuthOptions): IdentityProvider {
  const normalizer = options.normalize ?? defaultJwtNormalizer;
  const adapter = createAuthProviderAdapter({
    providerName: options.providerName ?? "jwt",
    normalize: normalizer,
  });

  return adapter.createIdentityProvider(async (token: string) => {
    const sections = parseJwtSections(token);
    if (!sections) {
      return null;
    }
    if (sections.header.alg !== "HS256") {
      return null;
    }
    if (!verifyHs256(sections.signingInput, sections.signaturePart ?? "", options.secret)) {
      return null;
    }
    const payload = sections.payload;
    if (options.issuer && payload["iss"] !== options.issuer) {
      return null;
    }
    if (options.audience) {
      const aud = payload["aud"];
      const audiences = Array.isArray(aud) ? aud.map(String) : aud ? [String(aud)] : [];
      if (!audiences.includes(options.audience)) {
        return null;
      }
    }
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload["exp"] === "number" && payload["exp"] < now) {
      return null;
    }
    if (typeof payload["nbf"] === "number" && payload["nbf"] > now) {
      return null;
    }
    return payload;
  });
}

export type IdentityAdapterContractTest = {
  name: string;
  run(): Promise<void>;
};

export function createIdentityAdapterContractTests(
  label: string,
  createProvider: () => IdentityProvider,
  options?: {
    validToken: string;
    invalidToken: string;
    expectedPrincipalId: string;
    expectedProvider: string;
    expectedGroups?: readonly string[];
    expectedRoles?: readonly string[];
    expectedScopes?: readonly string[];
    expectedTenantId?: string;
    expectedOrganizationId?: string;
    expectedEmail?: string;
    expectedUsername?: string;
  },
): IdentityAdapterContractTest[] {
  const opts = options ?? {
    validToken: "valid",
    invalidToken: "invalid",
    expectedPrincipalId: "test:subject",
    expectedProvider: label,
  };

  return [
    {
      name: `${label}: authenticates valid token and produces stable principal`,
      async run() {
        const provider = createProvider();
        const result = await provider.authenticate({
          method: "POST",
          path: "/threads",
          headers: { authorization: `Bearer ${opts.validToken}` },
        });
        if (!result.authenticated) {
          throw new Error(`Expected authenticated, got: ${result.reason}`);
        }
        const { principal } = result.context;
        if (principal.id !== opts.expectedPrincipalId) {
          throw new Error(`Expected principal id ${opts.expectedPrincipalId}, got ${principal.id}`);
        }
        if (principal.provider !== opts.expectedProvider) {
          throw new Error(`Expected provider ${opts.expectedProvider}, got ${principal.provider}`);
        }
        if (principal.aliases.length === 0) {
          throw new Error("Expected at least one alias");
        }
        const primaryAlias = principal.aliases[0];
        if (!primaryAlias || primaryAlias.subject.length === 0) {
          throw new Error("Expected primary alias to have a non-empty subject");
        }
      },
    },
    {
      name: `${label}: rejects invalid token`,
      async run() {
        const provider = createProvider();
        const result = await provider.authenticate({
          method: "POST",
          path: "/threads",
          headers: { authorization: `Bearer ${opts.invalidToken}` },
        });
        if (result.authenticated) {
          throw new Error("Expected unauthenticated result for invalid token");
        }
      },
    },
    {
      name: `${label}: rejects missing authorization header`,
      async run() {
        const provider = createProvider();
        const result = await provider.authenticate({
          method: "POST",
          path: "/threads",
          headers: {},
        });
        if (result.authenticated) {
          throw new Error("Expected unauthenticated result for missing header");
        }
      },
    },
    {
      name: `${label}: populates access context with groups, roles, scopes`,
      async run() {
        const provider = createProvider();
        const result = await provider.authenticate({
          method: "POST",
          path: "/threads",
          headers: { authorization: `Bearer ${opts.validToken}` },
        });
        if (!result.authenticated) {
          throw new Error(`Expected authenticated, got: ${result.reason}`);
        }
        const { access } = result.context;
        if (!access) {
          throw new Error("Expected access context to be populated");
        }
        if (opts.expectedGroups) {
          for (const group of opts.expectedGroups) {
            if (!access.groups.includes(group)) {
              throw new Error(`Expected group ${group} in access context`);
            }
          }
        }
        if (opts.expectedRoles) {
          for (const role of opts.expectedRoles) {
            if (!access.roles.includes(role)) {
              throw new Error(`Expected role ${role} in access context`);
            }
          }
        }
        if (opts.expectedScopes) {
          for (const scope of opts.expectedScopes) {
            if (!access.scopes.includes(scope)) {
              throw new Error(`Expected scope ${scope} in access context`);
            }
          }
        }
        if (opts.expectedTenantId && access.tenantId !== opts.expectedTenantId) {
          throw new Error(`Expected tenantId ${opts.expectedTenantId}, got ${access.tenantId}`);
        }
        if (opts.expectedOrganizationId && access.organizationId !== opts.expectedOrganizationId) {
          throw new Error(`Expected organizationId ${opts.expectedOrganizationId}, got ${access.organizationId}`);
        }
      },
    },
    {
      name: `${label}: emails and usernames appear only as aliases`,
      async run() {
        const provider = createProvider();
        const result = await provider.authenticate({
          method: "POST",
          path: "/threads",
          headers: { authorization: `Bearer ${opts.validToken}` },
        });
        if (!result.authenticated) {
          throw new Error(`Expected authenticated, got: ${result.reason}`);
        }
        const { principal } = result.context;
        if (opts.expectedEmail) {
          const emailAlias = principal.aliases.find((a) => a.provider === "email");
          if (!emailAlias || emailAlias.subject !== opts.expectedEmail) {
            throw new Error(`Expected email alias ${opts.expectedEmail}`);
          }
          if (principal.id === opts.expectedEmail) {
            throw new Error("Principal id must not be an email alias");
          }
        }
        if (opts.expectedUsername) {
          const usernameAlias = principal.aliases.find((a) => a.provider === "username");
          if (!usernameAlias || usernameAlias.subject !== opts.expectedUsername) {
            throw new Error(`Expected username alias ${opts.expectedUsername}`);
          }
          if (principal.id === opts.expectedUsername) {
            throw new Error("Principal id must not be a username alias");
          }
        }
      },
    },
    {
      name: `${label}: access context mirrors principal groups`,
      async run() {
        const provider = createProvider();
        const result = await provider.authenticate({
          method: "POST",
          path: "/threads",
          headers: { authorization: `Bearer ${opts.validToken}` },
        });
        if (!result.authenticated) {
          throw new Error(`Expected authenticated, got: ${result.reason}`);
        }
        const { principal, access } = result.context;
        if (!access) {
          throw new Error("Expected access context to be populated");
        }
        for (const group of principal.groups) {
          if (!access.groups.includes(group)) {
            throw new Error(`Expected principal group ${group} in access context`);
          }
        }
      },
    },
  ];
}
