export type CredentialKind = "secret" | "delegated-identity" | "scoped-token" | "browser-session";

export type CredentialScope = Record<string, string>;

export type CredentialRequest = {
  name: string;
  kind: CredentialKind;
  provider?: string;
  reason?: string;
  scopes?: string[];
  scope?: CredentialScope;
};

export type CredentialResolution = {
  name: string;
  kind: CredentialKind;
  source: string;
  value?: string;
  subject?: string;
  expiresAt?: string;
};

export type CredentialResolutionContext = {
  mailboxId: string;
  toolCallId: string;
  toolName: string;
};

export interface CredentialProvider {
  resolve(request: CredentialRequest, context: CredentialResolutionContext): Promise<CredentialResolution | null>;
}

export class StaticCredentialProvider implements CredentialProvider {
  constructor(
    private readonly values: Record<string, string>,
    private readonly source = "static",
  ) {}

  async resolve(request: CredentialRequest): Promise<CredentialResolution | null> {
    const value = this.values[request.name];
    if (value === undefined) {
      return null;
    }

    return {
      name: request.name,
      kind: request.kind,
      source: this.source,
      value,
    };
  }
}

export class EmptyCredentialProvider implements CredentialProvider {
  async resolve(): Promise<CredentialResolution | null> {
    return null;
  }
}

export class ResolvedCredentials {
  private readonly values: Map<string, CredentialResolution>;

  constructor(resolutions: readonly CredentialResolution[]) {
    this.values = new Map(resolutions.map((resolution) => [resolution.name, resolution]));
  }

  get(name: string): CredentialResolution {
    const resolution = this.values.get(name);
    if (!resolution) {
      throw new Error(`Credential not resolved: ${name}`);
    }
    return resolution;
  }

  value(name: string): string {
    const value = this.get(name).value;
    if (value === undefined) {
      throw new Error(`Credential has no in-process value: ${name}`);
    }
    return value;
  }

  has(name: string): boolean {
    return this.values.has(name);
  }

  names(): string[] {
    return [...this.values.keys()];
  }
}
