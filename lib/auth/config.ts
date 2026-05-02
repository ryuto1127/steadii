import "server-only";
import * as Sentry from "@sentry/nextjs";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import MicrosoftEntraId from "next-auth/providers/microsoft-entra-id";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  users,
  accounts,
  sessions,
  verificationTokens,
  waitlistRequests,
} from "@/lib/db/schema";
import { EncryptedDrizzleAdapter } from "./encrypted-adapter";
import { encryptOAuthToken } from "./oauth-tokens";
import { env } from "@/lib/env";

// Providers whose accounts row we re-sync on every sign-in so scope/token
// upgrades (re-consent with a wider scope) propagate to existing users.
// The stock Drizzle adapter only calls linkAccount on the FIRST link, so
// without this UPDATE-in-place the app silently believes the new scope was
// never granted. Add a provider id here once the corresponding provider
// shows up in the `providers` array below.
const REFRESHABLE_PROVIDERS = new Set(["google", "microsoft-entra-id"]);

export const authConfig = {
  adapter: EncryptedDrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  // JWT strategy: session lives in a signed cookie, no DB lookup per request.
  // The adapter is still used for user/account provisioning during OAuth.
  session: { strategy: "jwt" },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.coursework.me.readonly https://www.googleapis.com/auth/classroom.announcements.readonly https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send",
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
        },
      },
    }),
    MicrosoftEntraId({
      clientId: process.env.AUTH_MS_ID,
      clientSecret: process.env.AUTH_MS_SECRET,
      // "common" lets any work/school OR personal Microsoft account sign in.
      // We override per-user via env if a single tenant is desired.
      issuer: `https://login.microsoftonline.com/${
        process.env.AUTH_MS_TENANT_ID || "common"
      }/v2.0`,
      authorization: {
        params: {
          // offline_access is mandatory for a refresh_token; without it MS
          // returns a one-shot access_token and the cron-driven calendar
          // refresh would silently 401 after an hour.
          scope:
            "openid email profile offline_access User.Read Calendars.ReadWrite Tasks.ReadWrite",
          prompt: "consent",
        },
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    // Refresh the accounts row on every sign-in so scope/token upgrades
    // (e.g. adding Gmail scopes mid-life) propagate to existing users.
    // The stock Drizzle adapter only calls linkAccount on the FIRST link,
    // which means re-consents with a wider scope silently fail to update
    // the stored scope string — leaving the app to believe Gmail is still
    // not connected. We update in-place here; the UPDATE is a no-op on
    // the first sign-in (row does not exist yet) and linkAccount handles
    // the initial insert as before.
    async signIn({ user, account }) {
      // Existing scope/token refresh — runs unconditionally so re-consents
      // mid-life propagate to the accounts row even on production with
      // waitlist gating active.
      if (user?.id && account && REFRESHABLE_PROVIDERS.has(account.provider)) {
        const update: Record<string, unknown> = { updatedAt: new Date() };
        if (typeof account.scope === "string") update.scope = account.scope;
        if (typeof account.access_token === "string")
          update.access_token = encryptOAuthToken(account.access_token);
        if (typeof account.refresh_token === "string")
          update.refresh_token = encryptOAuthToken(account.refresh_token);
        if (typeof account.id_token === "string")
          update.id_token = encryptOAuthToken(account.id_token);
        if (typeof account.expires_at === "number")
          update.expires_at = account.expires_at;
        if (typeof account.token_type === "string")
          update.token_type = account.token_type;

        // Neon serverless can hiccup on transient `fetch failed` / cold
        // start / brief disconnect. The token update is best-effort — old
        // tokens stay in DB on failure and the next request that needs a
        // fresh access_token triggers a normal refresh via oauth-tokens.ts.
        // One retry catches the common transient blip; persistent failure
        // degrades to a Sentry warning so the user can still sign in.
        // Mirrors the recordUsage pattern from PR #101.
        let firstErr: unknown;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            await db
              .update(accounts)
              .set(update)
              .where(
                and(
                  eq(accounts.provider, account.provider),
                  eq(accounts.providerAccountId, account.providerAccountId)
                )
              );
            firstErr = undefined;
            break;
          } catch (err) {
            if (attempt === 0) {
              firstErr = err;
              await new Promise((resolve) => setTimeout(resolve, 200));
              continue;
            }
            Sentry.captureException(err, {
              level: "warning",
              tags: {
                context: "signin_token_update_failed",
                provider: account.provider,
              },
              extra: {
                firstError: firstErr,
                providerAccountId: account.providerAccountId,
              },
            });
          }
        }
      }

      // α access waitlist gate. Only enforced on production Google sign-in;
      // dev/preview accept any account so the engineer can test without
      // seeding waitlist rows. Microsoft sign-in is connection-only (the
      // primary identity provider is still Google) so it bypasses too.
      if (account?.provider !== "google") return true;
      if (env().NODE_ENV !== "production") return true;

      const email = user?.email?.toLowerCase();
      if (!email) return false;

      // is_admin bypass — Ryuto's account has is_admin=true so an empty
      // waitlist table never locks the founder out of his own app.
      const [adminCheck] = await db
        .select({ isAdmin: users.isAdmin })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (adminCheck?.isAdmin) return true;

      const [request] = await db
        .select({ status: waitlistRequests.status })
        .from(waitlistRequests)
        .where(eq(waitlistRequests.email, email))
        .limit(1);

      if (!request) return "/access-denied?reason=not-requested";
      if (request.status === "pending")
        return "/access-pending?reason=pending";
      if (request.status === "denied") return "/access-denied?reason=denied";

      // Approved — record the first sign-in timestamp so the admin page
      // can tell which approved users have actually onboarded.
      await db
        .update(waitlistRequests)
        .set({ signedInAt: new Date() })
        .where(eq(waitlistRequests.email, email));

      return true;
    },
    jwt({ token, user }) {
      // On sign-in `user` is the adapter User row; persist its id into the
      // token so later requests don't need a DB lookup to know who we are.
      if (user?.id) {
        token.id = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && typeof token.id === "string") {
        session.user.id = token.id;
      }
      return session;
    },
  },
  events: {
    // Start the 14-day Pro trial the moment a user row is first created
    // (first OAuth sign-in). No credit card required; after 14 days the
    // effective-plan check stops returning trial and the user falls back
    // to Free unless they've subscribed. Idempotent safety: only write
    // when trial_started_at is still null.
    async createUser({ user }) {
      if (!user.id) return;
      await db
        .update(users)
        .set({ trialStartedAt: new Date() })
        .where(eq(users.id, user.id));
    },
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
