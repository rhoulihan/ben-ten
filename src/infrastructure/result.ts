/**
 * A discriminated union type representing either success (Ok) or failure (Err).
 * Used for explicit error handling without exceptions.
 */
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/**
 * Creates a successful Result containing the given value.
 *
 * @param value - The success value
 * @returns A successful Result
 * @example
 * const result = ok(42);
 * // { ok: true, value: 42 }
 */
export const ok = <T>(value: T): Result<T, never> => ({
  ok: true,
  value,
});

/**
 * Creates a failed Result containing the given error.
 *
 * @param error - The error value
 * @returns A failed Result
 * @example
 * const result = err({ code: 'NOT_FOUND', message: 'Item not found' });
 * // { ok: false, error: { code: 'NOT_FOUND', message: 'Item not found' } }
 */
export const err = <E>(error: E): Result<never, E> => ({
  ok: false,
  error,
});

/**
 * Type guard that checks if a Result is successful.
 * Narrows the type to access the value property.
 *
 * @param result - The Result to check
 * @returns true if the Result is Ok
 * @example
 * if (isOk(result)) {
 *   console.log(result.value); // TypeScript knows value exists
 * }
 */
export const isOk = <T, E>(
  result: Result<T, E>,
): result is { readonly ok: true; readonly value: T } => result.ok;

/**
 * Type guard that checks if a Result is failed.
 * Narrows the type to access the error property.
 *
 * @param result - The Result to check
 * @returns true if the Result is Err
 * @example
 * if (isErr(result)) {
 *   console.log(result.error); // TypeScript knows error exists
 * }
 */
export const isErr = <T, E>(
  result: Result<T, E>,
): result is { readonly ok: false; readonly error: E } => !result.ok;

/**
 * Extracts the value from a successful Result or throws if failed.
 * Use sparingly - prefer pattern matching with isOk/isErr.
 *
 * @param result - The Result to unwrap
 * @returns The success value
 * @throws Error if the Result is failed
 * @example
 * const value = unwrap(ok(42)); // 42
 * const value = unwrap(err('failed')); // throws
 */
export const unwrap = <T, E>(result: Result<T, E>): T => {
  if (result.ok) {
    return result.value;
  }
  const errorMessage =
    typeof result.error === 'string'
      ? result.error
      : result.error instanceof Error
        ? result.error.message
        : JSON.stringify(result.error);
  throw new Error(errorMessage);
};

/**
 * Extracts the value from a successful Result or returns a default value.
 *
 * @param result - The Result to unwrap
 * @param defaultValue - Value to return if Result is failed
 * @returns The success value or the default
 * @example
 * const value = unwrapOr(ok(42), 0); // 42
 * const value = unwrapOr(err('failed'), 0); // 0
 */
export const unwrapOr = <T, E>(result: Result<T, E>, defaultValue: T): T => {
  if (result.ok) {
    return result.value;
  }
  return defaultValue;
};

/**
 * Transforms the success value of a Result using the given function.
 * If the Result is failed, returns it unchanged.
 *
 * @param result - The Result to transform
 * @param fn - Function to apply to the success value
 * @returns A new Result with the transformed value
 * @example
 * const result = map(ok(5), x => x * 2); // ok(10)
 * const result = map(err('failed'), x => x * 2); // err('failed')
 */
export const map = <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> => {
  if (result.ok) {
    return ok(fn(result.value));
  }
  return result;
};

/**
 * Transforms the error value of a Result using the given function.
 * If the Result is successful, returns it unchanged.
 *
 * @param result - The Result to transform
 * @param fn - Function to apply to the error value
 * @returns A new Result with the transformed error
 * @example
 * const result = mapErr(err('e'), e => ({ code: 'ERR', msg: e }));
 */
export const mapErr = <T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F,
): Result<T, F> => {
  if (result.ok) {
    return result;
  }
  return err(fn(result.error));
};

/**
 * Chains Result-returning functions together.
 * If the input is failed, returns it unchanged without calling fn.
 *
 * @param result - The Result to chain from
 * @param fn - Function that returns a new Result
 * @returns The Result from fn, or the original error
 * @example
 * const result = flatMap(ok(5), x => ok(x * 2)); // ok(10)
 * const result = flatMap(ok(5), x => err('failed')); // err('failed')
 * const result = flatMap(err('e'), x => ok(x * 2)); // err('e')
 */
export const flatMap = <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> => {
  if (result.ok) {
    return fn(result.value);
  }
  return result;
};
