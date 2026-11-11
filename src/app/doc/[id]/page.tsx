import { Suspense } from "react";
import { FullPageSpinner } from "@/components/screen";
import { DocScreen } from "./doc-screen";

// With cacheComponents on, useParams() on a dynamic route suspends, so it needs a Suspense boundary.
export default function DocPage() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <DocScreen />
    </Suspense>
  );
}
