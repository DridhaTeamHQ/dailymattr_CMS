"use client";

import { Suspense, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import ContentEditor from "@/components/ContentEditor";
import type { ContentKind } from "@/lib/types";

const VALID: ContentKind[] = ["pix", "qix", "trax"];

export default function KindEditorPage() {
  const { kind: raw } = useParams<{ kind: string }>();
  const router = useRouter();
  const kind = VALID.includes(raw as ContentKind) ? (raw as ContentKind) : null;

  useEffect(() => {
    if (!kind) router.replace("/dashboard");
  }, [kind, router]);

  if (!kind) return null;
  return (
    <Suspense>
      <ContentEditor kind={kind} />
    </Suspense>
  );
}
