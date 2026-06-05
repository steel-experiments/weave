import type { ApiRouteHandler } from "./api-server.js";
import type { AuthGateway } from "./auth-gateway.js";
import type { ThreadEngine } from "./contracts.js";
import { ThreadEventSchema, type ThreadEvent, type ThreadEventType } from "./events.js";
import type { ThreadService } from "./thread-service.js";
import type { AnyToolContract } from "./tool-contract.js";

export type IntegrationRuntimeContext = {
  engine: ThreadEngine;
  service: ThreadService;
  integrationName: string;
  auth?: AuthGateway;
};

export type IntegrationEventHandler = {
  eventTypes?: readonly ThreadEventType[];
  handle(event: ThreadEvent, context: IntegrationRuntimeContext): Promise<void> | void;
};

export type TypedIntegrationEventHandler<Type extends ThreadEventType = ThreadEventType> = IntegrationEventHandler & {
  eventTypes: readonly [Type];
  handle(event: Extract<ThreadEvent, { type: Type }>, context: IntegrationRuntimeContext): Promise<void> | void;
};

export function integrationEvent<const Type extends ThreadEventType>(options: {
  type: Type;
  handle(event: Extract<ThreadEvent, { type: Type }>, context: IntegrationRuntimeContext): Promise<void> | void;
}): TypedIntegrationEventHandler<Type> {
  return {
    eventTypes: [options.type],
    handle(event, context) {
      const parsed = ThreadEventSchema.parse(event);
      if (parsed.type !== options.type) {
        throw new Error(`Integration handler expected ${options.type}, received ${parsed.type}`);
      }

      return options.handle(parsed as Extract<ThreadEvent, { type: Type }>, context);
    },
  };
}

export type IntegrationContract<
  Name extends string = string,
  Tools extends readonly AnyToolContract[] = readonly AnyToolContract[],
> = {
  name: Name;
  description?: string;
  tools?: Tools;
  createRoutes?(context: IntegrationRuntimeContext): readonly ApiRouteHandler[];
  eventHandlers?: readonly IntegrationEventHandler[];
};

export type AnyIntegrationContract = IntegrationContract<string, readonly AnyToolContract[]>;

export function defineIntegration<
  const Name extends string,
  const Tools extends readonly AnyToolContract[] = readonly AnyToolContract[],
>(contract: IntegrationContract<Name, Tools>): IntegrationContract<Name, Tools> {
  return contract;
}

export const integration = defineIntegration;

export function collectIntegrationTools(
  integrations: readonly AnyIntegrationContract[] | undefined,
): AnyToolContract[] {
  const tools: AnyToolContract[] = [];
  for (const integration of integrations ?? []) {
    tools.push(...(integration.tools ?? []));
  }
  return tools;
}

export function createIntegrationRoutes(
  integrations: readonly AnyIntegrationContract[] | undefined,
  context: Omit<IntegrationRuntimeContext, "integrationName">,
): ApiRouteHandler[] {
  const routes: ApiRouteHandler[] = [];
  for (const integration of integrations ?? []) {
    routes.push(
      ...(integration.createRoutes?.({
        engine: context.engine,
        service: context.service,
        integrationName: integration.name,
        auth: context.auth,
      }) ?? []),
    );
  }
  return routes;
}
