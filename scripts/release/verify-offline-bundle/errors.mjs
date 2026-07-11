export class VerifyOfflineBundleError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "VerifyOfflineBundleError";
    this.code = code;
    this.details = details;
  }
}

export function stableStringify(value) {
  return `${JSON.stringify(sortJsonValue(value), null, 2)}\n`;
}

function sortJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, sortJsonValue(entryValue)]),
    );
  }
  return value;
}

export function isNodeError(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function isNoSpaceError(error) {
  if (isNodeError(error, "ENOSPC")) return true;
  return /\bENOSPC\b|no space left on device/i.test(errorMessage(error));
}
