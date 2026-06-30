import type { z } from "zod";
import type { CredentialKind, CredentialRequest, CredentialScope } from "./credentials.js";

export type CapabilityCredentialScope = {
  credentialName?: string;
  kind?: CredentialKind;
  provider?: string;
  resource?: string;
  permissions?: readonly string[];
  reason?: string;
  scope?: CredentialScope;
};

export type CapabilityContract<
  Name extends string = string,
  Scope = unknown,
  Params = Scope,
> = {
  name: Name;
  description: string;
  scopes?: z.ZodType<Scope>;
  params?: z.ZodType<Params>;
  scope?: (params: Params) => CapabilityCredentialScope;
  request(params: Params): CapabilityRequest<Name, Params>;
};

export type CapabilityRequest<
  Name extends string = string,
  Params = unknown,
> = {
  type: "capability.request";
  name: Name;
  description: string;
  params: Params;
  credential: CredentialRequest;
};

export type AnyCapabilityContract = CapabilityContract<string, any, any>;
export type AnyCapabilityRequest = CapabilityRequest<string, unknown>;
export type CapabilityDeclaration = AnyCapabilityContract | AnyCapabilityRequest;

export function defineCapability<
  const Name extends string,
  Scope,
  Params = Scope,
>(contract: Omit<CapabilityContract<Name, Scope, Params>, "request">): CapabilityContract<Name, Scope, Params> {
  const paramsSchema = contract.params ?? (contract.scopes as z.ZodType<Params> | undefined);
  const capability = {
    ...contract,
    request(params: Params): CapabilityRequest<Name, Params> {
      const parseResult = paramsSchema ? paramsSchema.safeParse(params) : { success: true as const, data: params };
      if (!parseResult.success) {
        throw new Error(`Invalid params for capability ${contract.name}`);
      }

      const parsedParams = parseResult.data;
      return {
        type: "capability.request",
        name: contract.name,
        description: contract.description,
        params: parsedParams,
        credential: capabilityCredentialRequest(contract, parsedParams),
      };
    },
  };

  return capability;
}

export const capability = defineCapability;

export function isCapabilityRequest(value: CapabilityDeclaration): value is AnyCapabilityRequest {
  return "type" in value && value.type === "capability.request";
}

export function capabilityCredentialRequest<Params>(
  capability: Pick<CapabilityContract<string, unknown, Params>, "name" | "description" | "scope">,
  params: Params,
): CredentialRequest {
  const scoped = capability.scope?.(params) ?? {};
  return {
    name: scoped.credentialName ?? capability.name,
    kind: scoped.kind ?? "scoped-token",
    provider: scoped.provider,
    reason: scoped.reason ?? capability.description,
    scopes: scoped.permissions ? [...scoped.permissions] : undefined,
    scope: {
      capability: capability.name,
      ...(scoped.resource ? { resource: scoped.resource } : {}),
      ...(scoped.scope ?? {}),
    },
  };
}

export function normalizeCapabilityDeclarations(
  declarations: CapabilityDeclaration | readonly CapabilityDeclaration[] | undefined,
): CapabilityDeclaration[] {
  if (!declarations) {
    return [];
  }
  return Array.isArray(declarations) ? [...(declarations as readonly CapabilityDeclaration[])] : [declarations as CapabilityDeclaration];
}
