import { describe, expect, it, vi, beforeEach } from "vitest";

let enqueuedEvents: Array<{ text: string; options: { sessionKey: string; contextKey: string } }> =
  [];

vi.mock("../../infra/system-events.js", () => ({
  enqueueSystemEvent: (text: string, options: { sessionKey: string; contextKey: string }) => {
    enqueuedEvents.push({ text, options });
  },
}));

vi.mock("../../auto-reply/dispatch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../auto-reply/dispatch.js")>();
  return {
    ...actual,
    dispatchInboundMessage: vi.fn(async () => ({
      queuedFinal: false,
      counts: { tool: 0, block: 0, final: 0 },
    })),
  };
});

import { createSignalEventHandler } from "./event-handler.js";

describe("signal group update messages", () => {
  beforeEach(() => {
    enqueuedEvents = [];
  });

  const createHandler = () =>
    createSignalEventHandler({
      runtime: { log: () => {}, error: () => {} } as any,
      cfg: { messages: { inbound: { debounceMs: 0 } } } as any,
      baseUrl: "http://localhost",
      accountId: "default",
      historyLimit: 0,
      groupHistories: new Map(),
      textLimit: 4000,
      dmPolicy: "open",
      allowFrom: ["*"],
      groupAllowFrom: ["*"],
      groupPolicy: "open",
      reactionMode: "off",
      reactionAllowlist: [],
      mediaMaxBytes: 1024,
      ignoreAttachments: true,
      sendReadReceipts: false,
      readReceiptsViaDaemon: false,
      fetchAttachment: async () => null,
      deliverReplies: async () => {},
      resolveSignalReactionTargets: () => [],
      isSignalReactionMessage: () => false as any,
      shouldEmitSignalReactionNotification: () => false,
      buildSignalReactionSystemEventText: () => "reaction",
    });

  it("emits system event when member joins group", async () => {
    const handler = createHandler();

    await handler({
      event: "receive",
      data: JSON.stringify({
        envelope: {
          sourceNumber: "+15550001111",
          sourceName: "Admin",
          timestamp: 1700000000000,
          dataMessage: {
            groupInfo: {
              groupId: "testGroupId123",
              groupName: "Test Group",
              type: "UPDATE",
              addedMembers: [{ uuid: "abc-123-def", name: "NewUser" }],
            },
          },
        },
      }),
    });

    expect(enqueuedEvents).toHaveLength(1);
    expect(enqueuedEvents[0].text).toContain("NewUser joined the group");
    expect(enqueuedEvents[0].text).toContain("Test Group");
    expect(enqueuedEvents[0].options.contextKey).toContain("signal:group:update");
  });

  it("emits system event when member leaves group", async () => {
    const handler = createHandler();

    await handler({
      event: "receive",
      data: JSON.stringify({
        envelope: {
          sourceNumber: "+15550001111",
          sourceName: "Admin",
          timestamp: 1700000000000,
          dataMessage: {
            groupInfo: {
              groupId: "testGroupId123",
              groupName: "Test Group",
              type: "UPDATE",
              removedMembers: [{ uuid: "xyz-789-abc", name: "LeavingUser" }],
            },
          },
        },
      }),
    });

    expect(enqueuedEvents).toHaveLength(1);
    expect(enqueuedEvents[0].text).toContain("LeavingUser left the group");
  });

  it("handles multiple members joining at once", async () => {
    const handler = createHandler();

    await handler({
      event: "receive",
      data: JSON.stringify({
        envelope: {
          sourceNumber: "+15550001111",
          sourceName: "Admin",
          timestamp: 1700000000000,
          dataMessage: {
            groupInfo: {
              groupId: "testGroupId123",
              groupName: "Test Group",
              type: "UPDATE",
              addedMembers: [
                { uuid: "abc-123", name: "User1" },
                { uuid: "def-456", name: "User2" },
              ],
            },
          },
        },
      }),
    });

    expect(enqueuedEvents).toHaveLength(1);
    expect(enqueuedEvents[0].text).toContain("User1, User2 joined the group");
  });

  it("uses UUID prefix when name is not available", async () => {
    const handler = createHandler();

    await handler({
      event: "receive",
      data: JSON.stringify({
        envelope: {
          sourceNumber: "+15550001111",
          sourceName: "Admin",
          timestamp: 1700000000000,
          dataMessage: {
            groupInfo: {
              groupId: "testGroupId123",
              groupName: "Test Group",
              type: "UPDATE",
              addedMembers: [{ uuid: "abcdefgh-1234-5678-9012-ijklmnopqrst" }],
            },
          },
        },
      }),
    });

    expect(enqueuedEvents).toHaveLength(1);
    expect(enqueuedEvents[0].text).toContain("abcdefgh joined the group");
  });

  it("ignores UPDATE messages with no member changes", async () => {
    const handler = createHandler();

    await handler({
      event: "receive",
      data: JSON.stringify({
        envelope: {
          sourceNumber: "+15550001111",
          sourceName: "Admin",
          timestamp: 1700000000000,
          dataMessage: {
            groupInfo: {
              groupId: "testGroupId123",
              groupName: "Test Group",
              type: "UPDATE",
              // No addedMembers or removedMembers
            },
          },
        },
      }),
    });

    expect(enqueuedEvents).toHaveLength(0);
  });

  it("ignores DELIVER type messages (normal messages)", async () => {
    const handler = createHandler();

    await handler({
      event: "receive",
      data: JSON.stringify({
        envelope: {
          sourceNumber: "+15550001111",
          sourceName: "Alice",
          timestamp: 1700000000000,
          dataMessage: {
            message: "Hello!",
            groupInfo: {
              groupId: "testGroupId123",
              groupName: "Test Group",
              type: "DELIVER",
            },
          },
        },
      }),
    });

    // Should not emit a system event for DELIVER type
    // (the message would be processed as a normal message instead)
    expect(enqueuedEvents).toHaveLength(0);
  });
});
