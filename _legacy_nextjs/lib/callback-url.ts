/**
 * Разрешённые относительные пути после входа (без открытого редиректа на внешние сайты).
 */
export function safeRelativeCallback(raw: string | null | undefined): string {
  if (raw == null || typeof raw !== "string") return "/";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return "/";
  const pathOnly = trimmed.split("?")[0]?.split("#")[0] ?? "/";
  return pathOnly.startsWith("/") && pathOnly.length > 0 ? pathOnly : "/";
}
