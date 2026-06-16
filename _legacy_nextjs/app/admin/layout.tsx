import type * as React from "react";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { sessionHasAdminAccess } from "@/lib/admin-access";

export default async function AdminRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/auth?callbackUrl=/admin");
  }
  if (!sessionHasAdminAccess(session)) {
    redirect("/");
  }
  return <>{children}</>;
}
