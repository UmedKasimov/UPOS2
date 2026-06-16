import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

/** Только для локального `next dev`, если в `.env.local` нет секрета (прод — обязателен `AUTH_SECRET`). */
const DEV_AUTH_SECRET_FALLBACK =
  "dev-only-upos-finance-auth-secret-not-for-production";

function resolveAuthSecret(): string | undefined {
  const fromEnv =
    process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      "[auth] Нет AUTH_SECRET в .env.local — для dev используется встроенный запасной секрет. Задайте свой: openssl rand -base64 32",
    );
    return DEV_AUTH_SECRET_FALLBACK;
  }
  return undefined;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: resolveAuthSecret(),
  providers: [
    Google,
    Credentials({
      id: "admin-credentials",
      name: "Администратор",
      credentials: {
        username: { label: "Логин", type: "text" },
        password: { label: "Пароль", type: "password" },
      },
      async authorize(credentials) {
        const expectedUser = process.env.ADMIN_BASIC_USER?.trim();
        const expectedPass = process.env.ADMIN_BASIC_PASSWORD?.trim();
        if (!expectedUser || !expectedPass) return null;

        const username = String(credentials?.username ?? "").trim();
        const password = String(credentials?.password ?? "").trim();
        if (username !== expectedUser || password !== expectedPass) return null;

        const displayName =
          process.env.ADMIN_DISPLAY_NAME?.trim() || "Администратор";

        return {
          id: "admin-credentials",
          name: displayName,
          email:
            process.env.ADMIN_SESSION_EMAIL?.trim() ?? "admin@upos.local",
          role: "admin",
        };
      },
    }),
  ],
  pages: {
    signIn: "/auth",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.role) {
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role as string | undefined;
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      try {
        const next = new URL(url);
        if (next.origin === baseUrl) return url;
      } catch {
        /* ignore */
      }
      return baseUrl;
    },
  },
});
