"use client";

import { Suspense } from "react";
import ContentEditor from "@/components/ContentEditor";

export default function ArticleEditorPage() {
  return (
    <Suspense>
      <ContentEditor kind="article" />
    </Suspense>
  );
}
