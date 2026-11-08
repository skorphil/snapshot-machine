/**
 * Type guard for dbus-next `Variant`-shaped objects, i.e. values that carry
 * both a `signature` string and a `value` property.
 */
function isVariantLike(
  value: unknown,
): value is { signature: string; value: unknown } {
  return (
    value !== null &&
    typeof value === "object" &&
    "signature" in value &&
    typeof value.signature === "string" &&
    "value" in value
  );
}

/** dbus-next returns `a{sv}` values as `Variant` objects; unwrap them. */
export function unwrapVariant(value: unknown): unknown {
  return isVariantLike(value) ? value.value : value;
}

/** `ay` options are NUL-terminated byte arrays per the portal spec. */
export function toNulTerminatedBytes(path: string): Uint8Array {
  return new TextEncoder().encode(`${path}\0`);
}
