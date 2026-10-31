import { connection } from "next/server";
import { Suspense } from "react";

/** The CMS is a client app rendered by the layout; this marker just opts the route out of prerendering. */
async function RequestTime() {
  await connection();
  return null;
}

export default function Page() {
  return (
    <Suspense>
      <RequestTime />
    </Suspense>
  );
}
