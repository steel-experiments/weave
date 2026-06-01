import type { GateRequest } from "./agent-contract.js";

export type ApprovalPolicyDecision = GateRequest | undefined;

export type ApprovalPolicy<Input> = {
  name: string;
  description?: string;
  requiresApproval(input: Input): boolean;
  gate(input: Input): GateRequest;
  evaluate(input: Input): ApprovalPolicyDecision;
};

export type ApprovalPolicyDefinition<Input> = {
  name: string;
  description?: string;
  requiresApproval(input: Input): boolean;
  gate(input: Input): GateRequest;
};

export function defineApprovalPolicy<Input>(definition: ApprovalPolicyDefinition<Input>): ApprovalPolicy<Input> {
  return {
    ...definition,
    evaluate(input) {
      return definition.requiresApproval(input) ? definition.gate(input) : undefined;
    },
  };
}

export const approvalPolicy = defineApprovalPolicy;
