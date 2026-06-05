import type { IncomingMessage } from "node:http";

export type IdentityAlias = {
  provider: string;
  subject: string;
};

export type Principal = {
  id: string;
  provider: string;
  aliases: readonly IdentityAlias[];
  groups: readonly string[];
  displayName?: string;
};

export type AuthContext = {
  principal: Principal;
  source: string;
  authenticatedAt: string;
};

export type AuthRequest = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
};

export type AuthResult =
  | { authenticated: true; context: AuthContext }
  | { authenticated: false; reason: string };

export type WeaveAction =
  | { type: "thread.start"; agentName?: string }
  | { type: "agent.run"; agentName: string }
  | { type: "thread.read"; threadId?: string }
  | { type: "thread.signal"; threadId?: string; signalName?: string }
  | { type: "gate.resolve"; threadId?: string; gateId?: string; resolution?: "approved" | "denied" }
  | { type: "thread.cancel"; threadId?: string }
  | { type: "artifact.read"; threadId?: string }
  | { type: "integration.trigger"; integrationName: string; triggerName?: string };

export type AuthorizationRequest = {
  context: AuthContext;
  action: WeaveAction;
};

export type AuthorizationDecision =
  | { allowed: true; reason?: string }
  | { allowed: false; reason: string };

export interface IdentityProvider {
  authenticate(request: AuthRequest): Promise<AuthResult>;
}

export interface AccessController {
  authorize(request: AuthorizationRequest): Promise<AuthorizationDecision>;
}

export interface AuthGateway {
  authenticate(input: AuthRequest): Promise<AuthResult>;
  authorize(input: AuthorizationRequest): Promise<AuthorizationDecision>;
}

export type AuthSummary = {
  principalId: string;
  provider: string;
  source: string;
};

export type AuthGatewayOptions = {
  identity: IdentityProvider;
  access: AccessController;
};

export function authGateway(options: AuthGatewayOptions): AuthGateway {
  return {
    async authenticate(input: AuthRequest): Promise<AuthResult> {
      return options.identity.authenticate(input);
    },
    async authorize(input: AuthorizationRequest): Promise<AuthorizationDecision> {
      return options.access.authorize(input);
    },
  };
}

export function anonymousAuth(): AuthGateway {
  const principal: Principal = {
    id: "anonymous",
    provider: "none",
    aliases: [],
    groups: [],
  };
  return authGateway({
    identity: {
      async authenticate(): Promise<AuthResult> {
        return {
          authenticated: true,
          context: {
            principal,
            source: "anonymous",
            authenticatedAt: new Date().toISOString(),
          },
        };
      },
    },
    access: {
      async authorize(): Promise<AuthorizationDecision> {
        return { allowed: true };
      },
    },
  });
}

export type BearerTokenAuthOptions = {
  verify: (token: string) => Promise<Principal | null> | Principal | null;
  source?: string;
};

export function bearerTokenAuth(options: BearerTokenAuthOptions): IdentityProvider {
  return {
    async authenticate(request: AuthRequest): Promise<AuthResult> {
      const authorizationHeader = request.headers["authorization"];
      const tokenValue = extractBearerToken(authorizationHeader);
      if (!tokenValue) {
        return { authenticated: false, reason: "Missing or invalid Authorization header" };
      }
      const principal = await options.verify(tokenValue);
      if (!principal) {
        return { authenticated: false, reason: "Invalid token" };
      }
      return {
        authenticated: true,
        context: {
          principal,
          source: options.source ?? "bearer-token",
          authenticatedAt: new Date().toISOString(),
        },
      };
    },
  };
}

function extractBearerToken(header: string | string[] | undefined): string | null {
  if (!header) {
    return null;
  }
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) {
    return null;
  }
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export type AccessRule = {
  match(request: AuthorizationRequest): boolean;
  decide(): AuthorizationDecision;
};

export type WeaveAccessPolicyOptions = {
  rules: readonly AccessRule[];
  defaultDecision?: AuthorizationDecision;
};

export function weaveAccessPolicy(options: WeaveAccessPolicyOptions): AccessController {
  const defaultDecision: AuthorizationDecision = options.defaultDecision ?? { allowed: false, reason: "No matching access rule" };
  return {
    async authorize(request: AuthorizationRequest): Promise<AuthorizationDecision> {
      for (const rule of options.rules) {
        if (rule.match(request)) {
          return rule.decide();
        }
      }
      return defaultDecision;
    },
  };
}

type RuleSubjectMatcher = (request: AuthorizationRequest) => boolean;
type RuleActionMatcher = (action: WeaveAction) => boolean;

function buildRule(subject: RuleSubjectMatcher, action: RuleActionMatcher, decision: AuthorizationDecision): AccessRule {
  return {
    match(request: AuthorizationRequest): boolean {
      return subject(request) && action(request.action);
    },
    decide(): AuthorizationDecision {
      return decision;
    },
  };
}

function matchActionType(actionType: WeaveAction["type"]): RuleActionMatcher {
  return (action: WeaveAction) => action.type === actionType;
}

function matchActionTypeAndAgentName(actionType: WeaveAction["type"], agentName: string): RuleActionMatcher {
  return (action: WeaveAction) => {
    if (action.type !== actionType) {
      return false;
    }
    return "agentName" in action && action.agentName === agentName;
  };
}

function matchPrincipalId(principalId: string): RuleSubjectMatcher {
  return (request: AuthorizationRequest) => request.context.principal.id === principalId;
}

function matchPrincipalGroup(group: string): RuleSubjectMatcher {
  return (request: AuthorizationRequest) => request.context.principal.groups.includes(group);
}

function matchAll(): RuleSubjectMatcher {
  return () => true;
}

export function allowService(serviceName: string) {
  return {
    toStartAgent(agentName: string): AccessRule {
      return buildRule(
        matchPrincipalId(serviceName),
        matchActionTypeAndAgentName("thread.start", agentName),
        { allowed: true, reason: `Service ${serviceName} allowed to start agent ${agentName}` },
      );
    },
    toStartAnyAgent(): AccessRule {
      return buildRule(
        matchPrincipalId(serviceName),
        matchActionType("thread.start"),
        { allowed: true, reason: `Service ${serviceName} allowed to start threads` },
      );
    },
  };
}

export function allowUser(userId: string) {
  return {
    toStartAgent(agentName: string): AccessRule {
      return buildRule(
        matchPrincipalId(userId),
        matchActionTypeAndAgentName("thread.start", agentName),
        { allowed: true, reason: `User ${userId} allowed to start agent ${agentName}` },
      );
    },
    toStartAnyAgent(): AccessRule {
      return buildRule(
        matchPrincipalId(userId),
        matchActionType("thread.start"),
        { allowed: true, reason: `User ${userId} allowed to start threads` },
      );
    },
  };
}

export function allowGroup(group: string) {
  return {
    toStartAgent(agentName: string): AccessRule {
      return buildRule(
        matchPrincipalGroup(group),
        matchActionTypeAndAgentName("thread.start", agentName),
        { allowed: true, reason: `Group ${group} allowed to start agent ${agentName}` },
      );
    },
    toStartAnyAgent(): AccessRule {
      return buildRule(
        matchPrincipalGroup(group),
        matchActionType("thread.start"),
        { allowed: true, reason: `Group ${group} allowed to start threads` },
      );
    },
  };
}

export function allowEveryone(): AccessRule {
  return buildRule(matchAll(), matchActionType("thread.start"), { allowed: true, reason: "Everyone allowed to start threads" });
}

export function denyEveryone(): AccessRule {
  return buildRule(matchAll(), matchActionType("thread.start"), { allowed: false, reason: "Everyone denied" });
}

function matchActionTypeAny(...actionTypes: WeaveAction["type"][]): RuleActionMatcher {
  return (action: WeaveAction) => actionTypes.includes(action.type);
}

export function allowUserToReadThreads(userId: string): AccessRule {
  return buildRule(
    matchPrincipalId(userId),
    matchActionTypeAny("thread.read"),
    { allowed: true, reason: `User ${userId} allowed to read threads` },
  );
}

export function allowUserToResolveGate(userId: string): AccessRule {
  return buildRule(
    matchPrincipalId(userId),
    matchActionTypeAny("gate.resolve"),
    { allowed: true, reason: `User ${userId} allowed to resolve gates` },
  );
}

export function allowUserToDeliverSignal(userId: string): AccessRule {
  return buildRule(
    matchPrincipalId(userId),
    matchActionTypeAny("thread.signal"),
    { allowed: true, reason: `User ${userId} allowed to deliver signals` },
  );
}

export function allowUserToCancelThread(userId: string): AccessRule {
  return buildRule(
    matchPrincipalId(userId),
    matchActionTypeAny("thread.cancel"),
    { allowed: true, reason: `User ${userId} allowed to cancel threads` },
  );
}

export function allowUserToReadArtifacts(userId: string): AccessRule {
  return buildRule(
    matchPrincipalId(userId),
    matchActionTypeAny("artifact.read"),
    { allowed: true, reason: `User ${userId} allowed to read artifacts` },
  );
}

export function allowGroupToReadThreads(group: string): AccessRule {
  return buildRule(
    matchPrincipalGroup(group),
    matchActionTypeAny("thread.read"),
    { allowed: true, reason: `Group ${group} allowed to read threads` },
  );
}

export function allowGroupToResolveGate(group: string): AccessRule {
  return buildRule(
    matchPrincipalGroup(group),
    matchActionTypeAny("gate.resolve"),
    { allowed: true, reason: `Group ${group} allowed to resolve gates` },
  );
}

export function allowGroupToDeliverSignal(group: string): AccessRule {
  return buildRule(
    matchPrincipalGroup(group),
    matchActionTypeAny("thread.signal"),
    { allowed: true, reason: `Group ${group} allowed to deliver signals` },
  );
}

export function allowGroupToCancelThread(group: string): AccessRule {
  return buildRule(
    matchPrincipalGroup(group),
    matchActionTypeAny("thread.cancel"),
    { allowed: true, reason: `Group ${group} allowed to cancel threads` },
  );
}

export function allowGroupToReadArtifacts(group: string): AccessRule {
  return buildRule(
    matchPrincipalGroup(group),
    matchActionTypeAny("artifact.read"),
    { allowed: true, reason: `Group ${group} allowed to read artifacts` },
  );
}

export function allowServiceToReadThreads(serviceName: string): AccessRule {
  return buildRule(
    matchPrincipalId(serviceName),
    matchActionTypeAny("thread.read"),
    { allowed: true, reason: `Service ${serviceName} allowed to read threads` },
  );
}

export function allowServiceToResolveGate(serviceName: string): AccessRule {
  return buildRule(
    matchPrincipalId(serviceName),
    matchActionTypeAny("gate.resolve"),
    { allowed: true, reason: `Service ${serviceName} allowed to resolve gates` },
  );
}

export function allowServiceToDeliverSignal(serviceName: string): AccessRule {
  return buildRule(
    matchPrincipalId(serviceName),
    matchActionTypeAny("thread.signal"),
    { allowed: true, reason: `Service ${serviceName} allowed to deliver signals` },
  );
}

export function allowServiceToCancelThread(serviceName: string): AccessRule {
  return buildRule(
    matchPrincipalId(serviceName),
    matchActionTypeAny("thread.cancel"),
    { allowed: true, reason: `Service ${serviceName} allowed to cancel threads` },
  );
}

export function allowServiceToReadArtifacts(serviceName: string): AccessRule {
  return buildRule(
    matchPrincipalId(serviceName),
    matchActionTypeAny("artifact.read"),
    { allowed: true, reason: `Service ${serviceName} allowed to read artifacts` },
  );
}

function matchIntegrationName(integrationName: string): RuleActionMatcher {
  return (action: WeaveAction) => {
    if (action.type !== "integration.trigger") {
      return false;
    }
    return action.integrationName === integrationName;
  };
}

function matchIntegrationNameAndTrigger(integrationName: string, triggerName: string): RuleActionMatcher {
  return (action: WeaveAction) => {
    if (action.type !== "integration.trigger") {
      return false;
    }
    return action.integrationName === integrationName && action.triggerName === triggerName;
  };
}

export function allowIntegrationToTrigger(integrationName: string): AccessRule {
  return buildRule(
    matchAll(),
    matchIntegrationName(integrationName),
    { allowed: true, reason: `Integration ${integrationName} allowed to trigger` },
  );
}

export function allowUserToTriggerIntegration(userId: string, integrationName: string): AccessRule {
  return buildRule(
    matchPrincipalId(userId),
    matchIntegrationName(integrationName),
    { allowed: true, reason: `User ${userId} allowed to trigger integration ${integrationName}` },
  );
}

export function allowGroupToTriggerIntegration(group: string, integrationName: string): AccessRule {
  return buildRule(
    matchPrincipalGroup(group),
    matchIntegrationName(integrationName),
    { allowed: true, reason: `Group ${group} allowed to trigger integration ${integrationName}` },
  );
}

export function allowUserToTriggerIntegrationAction(userId: string, integrationName: string, triggerName: string): AccessRule {
  return buildRule(
    matchPrincipalId(userId),
    matchIntegrationNameAndTrigger(integrationName, triggerName),
    { allowed: true, reason: `User ${userId} allowed to trigger ${triggerName} on integration ${integrationName}` },
  );
}

export function toAuthSummary(context: AuthContext): AuthSummary {
  return {
    principalId: context.principal.id,
    provider: context.principal.provider,
    source: context.source,
  };
}

export function authRequestFromIncoming(request: IncomingMessage): AuthRequest {
  const headers: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    headers[key] = value;
  }
  return {
    method: request.method ?? "GET",
    path: request.url ?? "/",
    headers,
  };
}
