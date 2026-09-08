const SECRET_PATTERNS = [
  /\b(?:sk|sess|key|token|secret)[-_][a-z0-9_-]{12,}\b/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
  /\b(?:api[_-]?key|authorization|password)\s*[:=]\s*["']?[^"'\s,}]+/gi,
];

export function redactSensitiveText(value: string): string {
  return SECRET_PATTERNS.reduce(
    (result, pattern) => result.replace(pattern, '[redacted]'),
    value,
  );
}

export function formatWarningList(warnings: string[]): string[] {
  return warnings.map((warning) => redactSensitiveText(warning).trim()).filter(Boolean);
}