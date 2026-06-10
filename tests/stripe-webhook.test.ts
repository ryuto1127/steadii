import { describe, expect, it, beforeEach, vi } from "vitest";
import type Stripe from "stripe";

// Test harness strategy (per W1 handoff DoD):
// - Do NOT mock Stripe signature verification. We test routeEvent() directly
//   with pre-parsed Stripe.Event objects, so the verifier is out of the path.
// - Mock the DB client at call-site granularity. Each table method returns a
//   chainable builder that records what was written; assertions inspect the
//   recorded calls.

const hoist = vi.hoisted(() => {
  const calls: Array<{ table: string; op: string; values?: unknown }> = [];
  // processed_stripe_events ledger: eventId → status ('processing'|'done').
  const processedEvents = new Map<string, "processing" | "done">();
  const subscriptionsByStripeId = new Map<string, Record<string, unknown>>();
  const userIdByCustomer = new Map<string, string>();
  // Test-controlled failure injection. When set, the next routeEvent side
  // effect (topup insert) throws once, then clears — modelling a handler
  // that fails on first delivery and succeeds on retry.
  const failNextSideEffect = { value: false };

  const selectChain = (result: unknown[]) => ({
    from: (t: { __name: string }) => ({
      where: () => ({
        limit: () => {
          if (t.__name === "subscriptions_by_sub_id") return result;
          if (t.__name === "subscriptions_by_customer") return result;
          return result;
        },
      }),
    }),
  });

  const db = {
    insert: (t: { __name: string }) => ({
      values: (values: Record<string, unknown>) => {
        calls.push({ table: t.__name, op: "insert", values });

        // processed_stripe_events: INSERT ... ON CONFLICT DO NOTHING
        // ... RETURNING. returning() yields [row] on a fresh insert, [] on
        // conflict.
        if (t.__name === "processed_stripe_events") {
          const id = values.eventId as string;
          const isNew = !processedEvents.has(id);
          if (isNew) {
            processedEvents.set(
              id,
              (values.status as "processing" | "done") ?? "processing"
            );
          }
          return {
            onConflictDoNothing: () => ({
              returning: async () => (isNew ? [{ eventId: id }] : []),
            }),
          };
        }

        // topup_balances is the side effect we fail on demand to model a
        // first-delivery throw. Real route catches unique-violations here,
        // so we throw a NON-unique error to force the 500 path.
        if (t.__name === "topup_balances" && failNextSideEffect.value) {
          failNextSideEffect.value = false;
          return {
            then: (_r: unknown, reject: (e: unknown) => unknown) =>
              reject(new Error("transient topup insert failure")),
          };
        }

        // All other inserts: a plain awaited insert.
        return {
          then: (resolve: (v: unknown) => unknown) => resolve(undefined),
        };
      },
    }),
    update: (t: { __name: string }) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          calls.push({ table: t.__name, op: "update", values });
          if (
            t.__name === "processed_stripe_events" &&
            values.status === "done"
          ) {
            for (const [id, st] of processedEvents) {
              if (st === "processing") processedEvents.set(id, "done");
            }
          }
        },
      }),
    }),
    select: (_cols?: unknown) => ({
      from: (t: { __name: string }) => ({
        where: () => ({
          limit: () => {
            if (t.__name === "processed_stripe_events") {
              // Tests exercise one event id at a time; return its status.
              const first = [...processedEvents.values()][0];
              return first ? [{ status: first }] : [];
            }
            if (t.__name === "subscriptions") {
              return [];
            }
            return [];
          },
        }),
      }),
    }),
  };

  return {
    calls,
    processedEvents,
    failNextSideEffect,
    subscriptionsByStripeId,
    userIdByCustomer,
    db,
    selectChain,
  };
});

vi.mock("@/lib/db/client", () => ({ db: hoist.db }));
vi.mock("@/lib/db/schema", () => ({
  subscriptions: {
    __name: "subscriptions",
    id: "id",
    userId: "userId",
    stripeSubscriptionId: "stripeSubscriptionId",
    stripeCustomerId: "stripeCustomerId",
  },
  auditLog: { __name: "audit_log" },
  users: { __name: "users", id: "id", dataRetentionExpiresAt: "dataRetentionExpiresAt" },
  invoices: { __name: "invoices" },
  processedStripeEvents: {
    __name: "processed_stripe_events",
    eventId: "eventId",
    status: "status",
  },
  topupBalances: { __name: "topup_balances" },
}));
vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
}));
vi.mock("@/lib/billing/stripe", () => ({
  stripe: () => ({
    webhooks: {
      // The POST idempotency tests need a parsed event from the raw body.
      // Signature verification itself is Stripe SDK's job (and covered by
      // their tests) — here we just round-trip the JSON the test posts.
      constructEvent: (rawBody: string) => JSON.parse(rawBody),
    },
    customers: {
      retrieve: async () => ({
        deleted: false,
        metadata: { steadii_user_id: "user_from_metadata" },
      }),
    },
  }),
}));
vi.mock("@/lib/env", () => ({
  env: () => ({
    STRIPE_WEBHOOK_SECRET: "whsec_test",
    STRIPE_PRICE_PRO_MONTHLY: "price_pro_m",
    STRIPE_PRICE_PRO_YEARLY: "price_pro_y",
    STRIPE_PRICE_STUDENT_4MO: "price_student",
  }),
}));
vi.mock("@/lib/billing/effective-plan", () => ({
  syncUsersPlanColumn: vi.fn(async () => {}),
}));

import { routeEvent, POST } from "@/app/api/stripe/webhook/route";

beforeEach(() => {
  hoist.calls.length = 0;
  hoist.processedEvents.clear();
  hoist.failNextSideEffect.value = false;
  hoist.subscriptionsByStripeId.clear();
  hoist.userIdByCustomer.clear();
});

function makeSubEvent(
  type:
    | "customer.subscription.created"
    | "customer.subscription.updated"
    | "customer.subscription.deleted",
  overrides: Partial<Stripe.Subscription> = {}
): Stripe.Event {
  const sub = {
    id: "sub_test",
    customer: "cus_test",
    status: "active",
    current_period_end: Math.floor(Date.now() / 1000) + 86_400,
    cancel_at_period_end: false,
    metadata: { steadii_user_id: "user_123" },
    items: { data: [{ price: { id: "price_pro_m" } }] },
    ...overrides,
  } as unknown as Stripe.Subscription;
  return {
    id: `evt_${Math.random().toString(36).slice(2, 10)}`,
    type,
    data: { object: sub },
  } as unknown as Stripe.Event;
}

function makeInvoiceEvent(
  type: "invoice.paid" | "invoice.payment_failed",
  overrides: Partial<Stripe.Invoice> = {}
): Stripe.Event {
  const invoice = {
    id: "in_test",
    customer: "cus_test",
    amount_paid: 2000,
    amount_due: 2000,
    subtotal: 2000,
    currency: "usd",
    invoice_pdf: "https://stripe.test/i.pdf",
    status_transitions: { paid_at: Math.floor(Date.now() / 1000) },
    ...overrides,
  } as unknown as Stripe.Invoice;
  return {
    id: `evt_${Math.random().toString(36).slice(2, 10)}`,
    type,
    data: { object: invoice },
  } as unknown as Stripe.Event;
}

describe("stripe webhook routeEvent", () => {
  it("handles subscription.created: upserts sub, sets plan_interval, logs audit, syncs plan", async () => {
    await routeEvent(makeSubEvent("customer.subscription.created"));
    const tables = hoist.calls.map((c) => `${c.table}.${c.op}`);
    expect(tables).toContain("subscriptions.insert");
    expect(tables).toContain("users.update");
    expect(tables).toContain("audit_log.insert");
    // plan_interval should be "monthly" for the Pro Monthly price id.
    const userUpdate = hoist.calls.find(
      (c) => c.table === "users" && c.op === "update"
    );
    expect((userUpdate?.values as { planInterval?: string }).planInterval).toBe(
      "monthly"
    );
  });

  it("handles subscription.created with Student price_id → plan_interval=four_month", async () => {
    await routeEvent(
      makeSubEvent("customer.subscription.created", {
        items: { data: [{ price: { id: "price_student" } }] },
      } as unknown as Partial<Stripe.Subscription>)
    );
    const userUpdate = hoist.calls.find(
      (c) => c.table === "users" && c.op === "update"
    );
    expect((userUpdate?.values as { planInterval?: string }).planInterval).toBe(
      "four_month"
    );
  });

  it("handles invoice.paid: inserts invoice row + audit log", async () => {
    await routeEvent(makeInvoiceEvent("invoice.paid"));
    const tables = hoist.calls.map((c) => `${c.table}.${c.op}`);
    expect(tables).toContain("invoices.insert");
    expect(tables).toContain("audit_log.insert");
    const invoiceInsert = hoist.calls.find(
      (c) => c.table === "invoices" && c.op === "insert"
    );
    const v = invoiceInsert?.values as {
      amountTotal: number;
      taxAmount: number;
      currency: string;
    };
    expect(v.amountTotal).toBe(2000);
    expect(v.taxAmount).toBe(0); // reserved until Stripe Tax enabled
    expect(v.currency).toBe("usd");
  });

  it("handles invoice.payment_failed: audit log only, no invoice row", async () => {
    await routeEvent(makeInvoiceEvent("invoice.payment_failed"));
    const tables = hoist.calls.map((c) => `${c.table}.${c.op}`);
    expect(tables).not.toContain("invoices.insert");
    expect(tables).toContain("audit_log.insert");
  });

  it("checkout.session.completed (subscription mode): no-op — subscription.created carries the data", async () => {
    const event = {
      id: "evt_co_sub",
      type: "checkout.session.completed",
      data: { object: { id: "cs_test", mode: "subscription" } },
    } as unknown as Stripe.Event;
    await routeEvent(event);
    expect(hoist.calls.filter((c) => c.op !== "insert" || c.table !== "processed_stripe_events")).toHaveLength(0);
  });

  it("checkout.session.completed (topup_500): inserts topup_balances row + audit log", async () => {
    const event = {
      id: "evt_topup",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_topup",
          mode: "payment",
          invoice: "in_topup",
          metadata: {
            steadii_user_id: "user_123",
            steadii_action: "topup_500",
          },
        },
      },
    } as unknown as Stripe.Event;
    await routeEvent(event);
    const tables = hoist.calls.map((c) => `${c.table}.${c.op}`);
    expect(tables).toContain("topup_balances.insert");
    expect(tables).toContain("audit_log.insert");
    const topup = hoist.calls.find(
      (c) => c.table === "topup_balances" && c.op === "insert"
    );
    const v = topup?.values as {
      creditsPurchased: number;
      creditsRemaining: number;
      expiresAt: Date;
    };
    expect(v.creditsPurchased).toBe(500);
    expect(v.creditsRemaining).toBe(500);
    // Expiry ~90 days out
    const daysUntilExpiry =
      (v.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysUntilExpiry).toBeGreaterThan(89);
    expect(daysUntilExpiry).toBeLessThan(91);
  });

  it("checkout.session.completed (topup_2000): 2000 credits inserted", async () => {
    const event = {
      id: "evt_topup_2k",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_topup_2k",
          mode: "payment",
          invoice: "in_topup_2k",
          metadata: {
            steadii_user_id: "user_123",
            steadii_action: "topup_2000",
          },
        },
      },
    } as unknown as Stripe.Event;
    await routeEvent(event);
    const topup = hoist.calls.find(
      (c) => c.table === "topup_balances" && c.op === "insert"
    );
    expect((topup?.values as { creditsPurchased: number }).creditsPurchased).toBe(
      2000
    );
  });

  it("checkout.session.completed (data_retention): updates users.dataRetentionExpiresAt", async () => {
    const event = {
      id: "evt_retention",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_ret",
          mode: "payment",
          metadata: {
            steadii_user_id: "user_123",
            steadii_action: "data_retention",
          },
        },
      },
    } as unknown as Stripe.Event;
    await routeEvent(event);
    const tables = hoist.calls.map((c) => `${c.table}.${c.op}`);
    expect(tables).toContain("users.update");
    expect(tables).toContain("audit_log.insert");
    const update = hoist.calls.find(
      (c) => c.table === "users" && c.op === "update"
    );
    const v = update?.values as { dataRetentionExpiresAt: Date };
    // Should be about 1 year out
    const daysOut =
      (v.dataRetentionExpiresAt.getTime() - Date.now()) /
      (24 * 60 * 60 * 1000);
    expect(daysOut).toBeGreaterThan(360);
    expect(daysOut).toBeLessThan(370);
  });

  it("ignores unknown event types (returns 200, no DB writes)", async () => {
    const event = {
      id: "evt_unknown",
      type: "radar.early_fraud_warning.created",
      data: { object: {} },
    } as unknown as Stripe.Event;
    await routeEvent(event);
    expect(hoist.calls.length).toBe(0);
  });
});

// ─── POST idempotency (processing/done state machine) ────────────────
//
// The old flow INSERTed the id BEFORE routeEvent, so a handler throw left
// the row behind and the retry was acked as a duplicate — the side effect
// never ran. The new flow gates on a status column: 'processing' on first
// insert, 'done' only after side effects succeed; a retry that finds
// 'processing' re-runs. These tests drive the full POST path (constructEvent
// is stubbed to parse the posted JSON; signature verification is Stripe's
// own concern).

function makePostRequest(event: Stripe.Event): Request {
  const body = JSON.stringify(event);
  return new Request("https://mysteadii.com/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=test" },
    body,
  });
}

function topupEvent(id: string): Stripe.Event {
  return {
    id,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_topup",
        mode: "payment",
        invoice: "in_topup",
        metadata: { steadii_user_id: "user_123", steadii_action: "topup_500" },
      },
    },
  } as unknown as Stripe.Event;
}

describe("stripe webhook POST idempotency", () => {
  it("first delivery: inserts 'processing', runs side effects, marks 'done'", async () => {
    const event = topupEvent("evt_first");
    const res = await POST(makePostRequest(event) as never);
    const json = (await res.json()) as { received?: boolean; duplicate?: boolean };

    expect(json.received).toBe(true);
    expect(json.duplicate).toBeUndefined();

    // Side effect ran exactly once.
    const topups = hoist.calls.filter(
      (c) => c.table === "topup_balances" && c.op === "insert"
    );
    expect(topups).toHaveLength(1);

    // Ledger row inserted as 'processing' then updated to 'done'.
    const insert = hoist.calls.find(
      (c) => c.table === "processed_stripe_events" && c.op === "insert"
    );
    expect((insert?.values as { status?: string }).status).toBe("processing");
    const update = hoist.calls.find(
      (c) => c.table === "processed_stripe_events" && c.op === "update"
    );
    expect((update?.values as { status?: string }).status).toBe("done");
    expect(hoist.processedEvents.get("evt_first")).toBe("done");
  });

  it("handler fails then retry fulfills exactly once", async () => {
    const event = topupEvent("evt_retry");

    // First delivery — the topup insert throws once → 500, row left
    // 'processing', NO status='done' update.
    hoist.failNextSideEffect.value = true;
    const failRes = await POST(makePostRequest(event) as never);
    expect(failRes.status).toBe(500);
    expect(hoist.processedEvents.get("evt_retry")).toBe("processing");
    const doneUpdatesAfterFail = hoist.calls.filter(
      (c) =>
        c.table === "processed_stripe_events" &&
        c.op === "update" &&
        (c.values as { status?: string }).status === "done"
    );
    expect(doneUpdatesAfterFail).toHaveLength(0);

    // Retry — same event id, now the 'processing' row makes POST re-run
    // (instead of acking as duplicate). Side effect succeeds this time.
    hoist.calls.length = 0;
    const retryRes = await POST(makePostRequest(event) as never);
    const retryJson = (await retryRes.json()) as { received?: boolean };
    expect(retryJson.received).toBe(true);

    const topupsOnRetry = hoist.calls.filter(
      (c) => c.table === "topup_balances" && c.op === "insert"
    );
    expect(topupsOnRetry).toHaveLength(1); // fulfilled, exactly once total
    expect(hoist.processedEvents.get("evt_retry")).toBe("done");
  });

  it("duplicate after done: acked without re-running side effects", async () => {
    const event = topupEvent("evt_dupe");

    // First delivery completes → 'done'.
    await POST(makePostRequest(event) as never);
    expect(hoist.processedEvents.get("evt_dupe")).toBe("done");

    // Duplicate delivery of the same event id.
    hoist.calls.length = 0;
    const dupRes = await POST(makePostRequest(event) as never);
    const dupJson = (await dupRes.json()) as {
      received?: boolean;
      duplicate?: boolean;
    };
    expect(dupJson.received).toBe(true);
    expect(dupJson.duplicate).toBe(true);

    // No side effects re-ran.
    const topupsOnDup = hoist.calls.filter(
      (c) => c.table === "topup_balances" && c.op === "insert"
    );
    expect(topupsOnDup).toHaveLength(0);
  });
});
