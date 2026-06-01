import type { ApiRouteHandler } from "./api-server.js";
import type { ThreadEngine } from "./contracts.js";
import type { ThreadEvent, ThreadEventType } from "./events.js";
import type { ThreadService } from "./thread-service.js";
import type { AnyToolContract } from "./tool-contract.js";

export type IntegrationRuntimeContext = {
  engine: ThreadEngine;
  service: ThreadService;
  integrationName: string;
};

export type IntegrationEventHandler = {
  eventTypes?: readonly ThreadEventType[];
  handle(event: ThreadEvent, context: IntegrationRuntimeContext): Promise<void> | void;
};

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
        ...context,
        integrationName: integration.name,
      }) ?? []),
    );
  }
  return routes;
}
