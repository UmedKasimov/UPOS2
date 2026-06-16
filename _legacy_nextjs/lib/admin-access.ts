/** Email из Google в нижнем регистре для сравнения. */
export function parseAdminEmailSet(): Set<string> {
  const raw = process.env.AUTH_ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAllowedAdmin(email: string | null | undefined): boolean {
  const admins = parseAdminEmailSet();
  if (admins.size === 0) return false;
  const e = email?.trim().toLowerCase();
  return Boolean(e && admins.has(e));
}

/** Доступ к /admin: парольный вход с role=admin или Google-почта из списка. */
export function sessionHasAdminAccess(session: {
  user?: { email?: string | null; role?: string } | null;
} | null): boolean {
  if (!session?.user) return false;
  if (session.user.role === "admin") return true;
  return isAllowedAdmin(session.user.email);
}
