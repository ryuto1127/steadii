import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    // Redact user-typed strings from breadcrumbs in α; revisit before β.
    sendDefaultPii: false,
  });
}
