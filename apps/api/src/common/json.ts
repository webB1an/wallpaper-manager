export function enableJsonBigIntSerialization() {
  const proto = BigInt.prototype as typeof BigInt.prototype & { toJSON?: () => string };
  if (typeof proto.toJSON === "function") return;
  Object.defineProperty(proto, "toJSON", {
    value() {
      return this.toString();
    },
    configurable: true,
  });
}
