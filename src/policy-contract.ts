import type { GateRequest, ToolCallOptions } from "./agent-contract.js";
import type { AnyCapabilityContract } from "./capability-contract.js";

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

export type ToolPolicyRequest<Input = unknown> = {
  type: "tool";
  threadId: string;
  agentName: string;
  scopeKey: string;
  stepKey: string;
  toolName: string;
  input: Input;
  options?: ToolCallOptions;
  capabilities: readonly AnyCapabilityContract[];
};

export type PolicyRequest = ToolPolicyRequest;

export type PolicyDecision =
  | {
      outcome: "allow";
      reason?: string;
    }
  | {
      outcome: "deny";
      reason: string;
    }
  | {
      outcome: "approval_required";
      reason?: string;
      gate: GateRequest;
    };

export type PolicyRule<Request extends PolicyRequest = PolicyRequest> = {
  name: string;
  version?: string;
  description?: string;
  evaluate(request: Request): PolicyDecision | undefined;
};

export type AnyPolicyRule = PolicyRule<PolicyRequest>;

export function definePolicy<const Name extends string, Request extends PolicyRequest = PolicyRequest>(
  rule: PolicyRule<Request> & { name: Name },
): PolicyRule<Request> & { name: Name } {
  return rule;
}

export const policy = definePolicy;
