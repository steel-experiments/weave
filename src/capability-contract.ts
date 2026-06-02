import type { z } from "zod";

export type CapabilityContract<
  Name extends string = string,
  Scope = unknown,
> = {
  name: Name;
  description: string;
  scopes: z.ZodType<Scope>;
};

export type AnyCapabilityContract = CapabilityContract<string, unknown>;

export function defineCapability<
  const Name extends string,
  Scope,
>(contract: CapabilityContract<Name, Scope>): CapabilityContract<Name, Scope> {
  return contract;
}

export const capability = defineCapability;
