"use client";

import Link from "next/link";
import { useSiteHref } from "@/lib/auth";

export function SiteLink({
  href,
  ...props
}: React.ComponentProps<typeof Link> & { href: string }) {
  const resolved = useSiteHref(href);
  return <Link {...props} href={resolved} />;
}
