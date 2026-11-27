import { describe, expect, it, vi } from "vitest";
import { createWardenTaskFeed } from "./warden-task-feed.js";

const config = {
  WARDEN_TASKS_BASE_URL: "https://tasks.example.test/service",
  WARDEN_TASKS_TOKEN: "fixture-token",
  WARDEN_TASKS_BINDINGS: JSON.stringify([{ botId: "bot-a", requestedBy: "owner-a" }]),
};

describe("task feed HTTP adapter", () => {
  it("normalizes display fields and protects transport credentials", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        tasks: [
          {
            id: "task/a ?",
            requested_by: { id: "owner-a", name: "Untrusted display name" },
            state: "running",
            turn_done: true,
            title: "Example task",
            started_at: 1_800_000_000,
            last_activity: "2027-01-16T06:40:30Z",
            box: "fixture-box",
            model: "fixture-model",
            progress: 0.5,
            html: "not a card field",
          },
        ],
      }),
    );
    const feed = createWardenTaskFeed(config, request)!;
    expect(await feed.list()).toEqual({
      kind: "ready",
      tasks: [
        {
          requestedBy: "owner-a",
          card: {
            id: "task/a ?",
            title: "Example task",
            status: "done",
            startedAt: 1_800_000_000_000,
            endedAt: Date.parse("2027-01-16T06:40:30Z"),
            box: "fixture-box",
            model: "fixture-model",
            progress: 0.5,
            href: "https://tasks.example.test/service/t/task%2Fa%20%3F",
          },
        },
      ],
    });
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "https://tasks.example.test/service/api/tasks?include_ended=true",
      expect.objectContaining({
        redirect: "error",
        headers: { Accept: "application/json", Authorization: "Bearer fixture-token" },
      }),
    );
  });

  it("marks upstream access revocation separately from an outage", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const feed = createWardenTaskFeed(config, request)!;
    await expect(feed.list()).resolves.toEqual({ kind: "forbidden" });
    await expect(feed.list()).resolves.toEqual({ kind: "offline" });
  });

  it("refuses an unauthenticated URL scheme or an ambiguous requester mapping", () => {
    expect(() =>
      createWardenTaskFeed({ ...config, WARDEN_TASKS_BASE_URL: "http://tasks.example.test" }),
    ).toThrow();
    expect(() =>
      createWardenTaskFeed({
        ...config,
        WARDEN_TASKS_BINDINGS: JSON.stringify([
          { botId: "a", requestedBy: "same" },
          { botId: "b", requestedBy: "same" },
        ]),
      }),
    ).toThrow();
  });
});
