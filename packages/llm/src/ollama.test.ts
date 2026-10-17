import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callLLM, createClient } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("local Ollama transport", () => {
  it("uses the installed tag with bounded native context, no thinking and real usage", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: "qwen3.8:27b",
            message: { content: '{"answer":"ok"}' },
            prompt_eval_count: 120,
            eval_count: 8,
            done_reason: "stop",
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1/");
    vi.stubEnv("OLLAMA_NUM_CTX", "8192");
    const result = await callLLM({
      client: createClient("", "ollama"),
      model: "qwen3.8:27b",
      system: "JSON",
      user: "test",
      schema: z.object({ answer: z.string() }),
    });
    const [url, init] = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0]!;
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "qwen3.8:27b",
      format: "json",
      stream: false,
      think: false,
      options: { num_ctx: 8192, temperature: 0 },
    });
    expect(result.data.answer).toBe("ok");
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 8 });
  });

  it("preserves Ollama error status and identifies a missing model without retry", async () => {
    const fetchMock = vi.fn(
      async () => new Response('{"error":"model not found"}', { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      callLLM({
        client: createClient("", "ollama"),
        model: "absent",
        system: "JSON",
        user: "test",
        schema: z.object({}),
      }),
    ).rejects.toThrow(/Ollama/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid context configuration before a request", () => {
    vi.stubEnv("OLLAMA_NUM_CTX", "NaN");
    expect(() => createClient("", "ollama")).toThrow(/OLLAMA_NUM_CTX/);
  });

  it("rejects oversized text context before inference instead of truncating evidence", async () => {
    vi.stubEnv("OLLAMA_NUM_CTX", "8192");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      callLLM({
        client: createClient("", "ollama"),
        model: "qwen3.8:27b",
        system: "JSON",
        user: "a".repeat(8192),
        schema: z.object({}),
      }),
    ).rejects.toThrow(/source too large/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
