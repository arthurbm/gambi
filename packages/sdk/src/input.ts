/**
 * What an input of the SDK loses on its way in, at every `Promise` boundary:
 * the management client and the two hosting entries alike.
 *
 * Internal: each entry embeds its own copy of this file.
 */

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/**
 * `value` without the keys that hold `undefined`, at any depth of its plain
 * objects. A form, or a spread of optional values, leaves such keys behind,
 * and the contract refuses a field that is present without a value: to a
 * consumer the two mean the same, "not given".
 */
export const withoutUndefined = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map(withoutUndefined) as T;
  }
  if (!isPlainObject(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, field]) => field !== undefined)
      .map(([key, field]) => [key, withoutUndefined(field)])
  ) as T;
};
