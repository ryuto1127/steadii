import "server-only";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, accounts, sessions, verificationTokens } from "@/lib/db/schema";
import { EncryptedDrizzleAdapter } from "./encrypted-adapter";
import { encryptOAuthToken } from "./oauth-tokens";

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
      if (!user?.id || !account) return true;
      if (account.provider !== "google") return true;

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

      await db
        .update(accounts)
        .set(update)
        .where(
          and(
            eq(accounts.provider, "google"),
            eq(accounts.providerAccountId, account.providerAccountId)
          )
        );
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
