import type { Range } from "./range.js";
export type Severity = "error" | "warning" | "info";
/**
 * Stable diagnostic codes
 * v0.1: E001-E010
 * v1 additions preserved as optional for layout/render comparison (surviving dist has E001-E014):
 * E011 duplicate group, E012 unclosed group, E013 invalid metadata, E014 invalid annotation/link
 * v1.2 adds E015 duplicate edge id (additive: only emitted for explicit `ID:` edge prefixes).
 * v0.2 checkpoint retains v0.1 set as primary, superset allowed for compatibility with surviving artifacts.
 */
export type DiagnosticCode =
  | "E001"
  | "E002"
  | "E003"
  | "E004"
  | "E005"
  | "E006"
  | "E007"
  | "E008"
  | "E009"
  | "E010"
  | "E011"
  | "E012"
  | "E013"
  | "E014"
  | "E015";
export interface Diagnostic {
  severity: Severity;
  code: DiagnosticCode;
  message: string;
  range: Range;
}
export function diag(
  severity: Severity,
  code: DiagnosticCode,
  message: string,
  range: Range,
): Diagnostic {
  return { severity, code, message, range };
}
