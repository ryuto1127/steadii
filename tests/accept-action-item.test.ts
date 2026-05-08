import { beforeEach, describe, expect, it, vi } from "vitest";

// engineer-39 — accept action item. Verifies:
//   1. createAssignment is called with the item's title + due + classId
//   2. Google Tasks insert is attempted with the same item
//   3. accepted_action_item_indices is updated atomically
//   4. Idempotent: a second call with the same index short-circuits and
//      does NOT call createAssignment again

vi.mock("server-only", () => ({}));

const tag = (name: string) => ({ __tag: name });

const inboxItemsSchema = {
  id: tag("inboxItems.id"),
  classId: tag("inboxItems.classId"),
  subject: tag("inboxItems.subject"),
};
const agentDraftsSchema = {
  id: tag("agentDrafts.id"),
  userId: tag("agentDrafts.userId"),
  inboxItemId: tag("agentDrafts.inboxItemId"),
  extractedActionItems: tag("agentDrafts.extractedActionItems"),
  acceptedActionItemIndices: tag("agentDrafts.acceptedActionItemIndices"),
};

vi.mock("@/lib/db/schema", () => ({
  inboxItems: inboxItemsSchema,
  agentDrafts: agentDraftsSchema,
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ kind: "and", args }),
  eq: (col: unknown, val: unknown) => ({ kind: "eq", col, val }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  startSpan: <T,>(_opts: unknown, fn: () => Promise<T>) => fn(),
  captureException: vi.fn(),
}));

const sessionUserIdRef: { value: string | null } = { value: "u1" };
vi.mock("@/lib/auth/config", () => ({
  auth: async () =>
    sessionUserIdRef.value ? { user: { id: sessionUserIdRef.value } } : null,
}));

const draftRowRef: {
  value: {
    draft: {
      id: string;
      userId: string;
      inboxItemId: string;
      extractedActionItems: Array<{
        title: string;
        dueDate: string | null;
        confidence: number;
      }>;
      acceptedActionItemIndices: number[];
    };
    inbox: {
      id: string;
      classId: string | null;
      subject: string | null;
    };
  } | null;
} = { value: null };

const updateCalls: Array<{ table: unknown; set: Record<string, unknown> }> = [];

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () =>
              draftRowRef.value ? [draftRowRef.value] : [],
          }),
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: () => {
          updateCalls.push({ table, set });
          return Promise.resolve();
        },
      }),
    }),
  },
}));

const createAssignmentMock = vi.fn<(args: unknown) => Promise<{ id: string }>>(
  async () => ({ id: "asg-1" })
);
vi.mock("@/lib/assignments/save", () => ({
  createAssignment: (args: unknown) => createAssignmentMock(args),
}));

const tasksInsertMock = vi.fn<(args: unknown) => Promise<unknown>>(
  async () => ({ data: { id: "g-task-1" } })
);
class FakeTasksNotConnectedError extends Error {
  code = "TASKS_NOT_CONNECTED" as const;
}
vi.mock("@/lib/integrations/google/tasks", () => ({
  TasksNotConnectedError: FakeTasksNotConnectedError,
  dueFromDateOnly: (d: string) => `${d}T00:00:00.000Z`,
  getTasksForUser: async () => ({
    tasks: { insert: (args: unknown) => tasksInsertMock(args) },
  }),
}));

beforeEach(() => {
  sessionUserIdRef.value = "u1";
  draftRowRef.value = null;
  updateCalls.length = 0;
  createAssignmentMock.mockClear();
  tasksInsertMock.mockClear();
});

describe("acceptDraftActionItemAction", () => {
  it("writes the assignment + Google Task on first accept and marks the index", async () => {
    draftRowRef.value = {
      draft: {
        id: "d1",
        userId: "u1",
        inboxItemId: "i1",
        extractedActionItems: [
          { title: "Submit photo ID", dueDate: "2026-05-15", confidence: 0.9 },
        ],
        acceptedActionItemIndices: [],
      },
      inbox: {
        id: "i1",
        classId: "cls-mat223",
        subject: "Registrar request",
      },
    };

    const { acceptDraftActionItemAction } = await import(
      "@/app/app/inbox/[id]/_actions"
    );
    const out = await acceptDraftActionItemAction("d1", 0);

    expect(out.ok).toBe(true);
    expect(createAssignmentMock).toHaveBeenCalledTimes(1);
    const arg = createAssignmentMock.mock.calls[0][0] as {
      input: { title: string; classId: string | null };
    };
    expect(arg.input.title).toBe("Submit photo ID");
    expect(arg.input.classId).toBe("cls-mat223");
    expect(tasksInsertMock).toHaveBeenCalledTimes(1);

    // The accepted index is recorded.
    expect(updateCalls.length).toBe(1);
    const set = updateCalls[0].set as {
      acceptedActionItemIndices: number[];
    };
    expect(set.acceptedActionItemIndices).toEqual([0]);
  });

  it("is idempotent — a second click with the same index does NOT re-write", async () => {
    draftRowRef.value = {
      draft: {
        id: "d1",
        userId: "u1",
        inboxItemId: "i1",
        extractedActionItems: [
          { title: "Submit photo ID", dueDate: null, confidence: 0.9 },
        ],
        acceptedActionItemIndices: [0],
      },
      inbox: { id: "i1", classId: null, subject: null },
    };

    const { acceptDraftActionItemAction } = await import(
      "@/app/app/inbox/[id]/_actions"
    );
    const out = await acceptDraftActionItemAction("d1", 0);
    if (out.ok) {
      expect(out.alreadyAccepted).toBe(true);
    } else {
      throw new Error("expected ok");
    }
    expect(createAssignmentMock).not.toHaveBeenCalled();
    expect(tasksInsertMock).not.toHaveBeenCalled();
    expect(updateCalls.length).toBe(0);
  });

  it("rejects out-of-range item indices", async () => {
    draftRowRef.value = {
      draft: {
        id: "d1",
        userId: "u1",
        inboxItemId: "i1",
        extractedActionItems: [
          { title: "A", dueDate: null, confidence: 0.9 },
        ],
        acceptedActionItemIndices: [],
      },
      inbox: { id: "i1", classId: null, subject: null },
    };

    const { acceptDraftActionItemAction } = await import(
      "@/app/app/inbox/[id]/_actions"
    );
    const out = await acceptDraftActionItemAction("d1", 5);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toBe("invalid_item_index");
    }
  });

  it("rejects unauthenticated callers", async () => {
    sessionUserIdRef.value = null;
    const { acceptDraftActionItemAction } = await import(
      "@/app/app/inbox/[id]/_actions"
    );
    const out = await acceptDraftActionItemAction("d1", 0);
    expect(out.ok).toBe(false);
  });

  it("survives Google Tasks not connected (soft-fail) and still writes the assignment", async () => {
    draftRowRef.value = {
      draft: {
        id: "d1",
        userId: "u1",
        inboxItemId: "i1",
        extractedActionItems: [
          { title: "Reply to TA", dueDate: null, confidence: 0.8 },
        ],
        acceptedActionItemIndices: [],
      },
      inbox: { id: "i1", classId: null, subject: null },
    };

    tasksInsertMock.mockImplementationOnce(async () => {
      throw new FakeTasksNotConnectedError();
    });

    const { acceptDraftActionItemAction } = await import(
      "@/app/app/inbox/[id]/_actions"
    );
    const out = await acceptDraftActionItemAction("d1", 0);
    expect(out.ok).toBe(true);
    expect(createAssignmentMock).toHaveBeenCalledTimes(1);
    expect(updateCalls.length).toBe(1);
  });
});
