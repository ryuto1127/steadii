"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body style={{ padding: 40, fontFamily: "system-ui" }}>
        <h1 style={{ fontSize: 28 }}>Something went very wrong.</h1>
        <p style={{ marginTop: 12, color: "#555" }}>
          The error has been reported. Please refresh the page.
        </p>
      </body>
    </html>
  );
}
