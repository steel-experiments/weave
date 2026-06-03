export type InternalEffectResult<Failure, Value> =
  | { ok: true; value: Value }
  | { ok: false; error: Failure };

export type InternalEffect<Failure, Value> = () => Promise<InternalEffectResult<Failure, Value>>;

export function internalTryPromise<Failure, Value>(options: {
  try: () => Promise<Value> | Value;
  catch: (error: unknown) => Failure;
}): InternalEffect<Failure, Value> {
  return async () => {
    try {
      return { ok: true, value: await options.try() };
    } catch (error) {
      return { ok: false, error: options.catch(error) };
    }
  };
}

export function runInternalEffect<Failure, Value>(
  effect: InternalEffect<Failure, Value>,
): Promise<InternalEffectResult<Failure, Value>> {
  return effect();
}
