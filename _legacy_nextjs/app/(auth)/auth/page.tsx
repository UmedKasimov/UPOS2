import { Suspense } from "react";

import { AuthScreen } from "@/components/auth/auth-screen";

function AuthFallback() {
  return (
    <div className="flex w-full max-w-[440px] flex-col items-center gap-8">
      <div className="bg-muted h-14 w-56 animate-pulse rounded-lg" />
      <div className="bg-muted h-[420px] w-full animate-pulse rounded-xl" />
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={<AuthFallback />}>
      <AuthScreen />
    </Suspense>
  );
}
