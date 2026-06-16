import type * as React from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/auth";

export default async function BusinessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    const h = await headers();
    const pathname = h.get("x-pathname") ?? "/";
    redirect(`/auth?callbackUrl=${encodeURIComponent(pathname)}`);
  }
  return <>{children}</>;
}
