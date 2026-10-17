// Adapt the shared OpenAI client to Ollama's native chat API so num_ctx is
// bounded per request. /v1/chat/completions cannot configure context length.
// Keep the actual installed model tag; no model copies or server changes.
export function ollamaFetch(baseURL: string): typeof fetch {
  const nativeURL = `${baseURL.replace(/\/v1\/?$/, "")}/api/chat`;
  const numCtx = positiveInt("OLLAMA_NUM_CTX", 32768);
  const numPredict = positiveInt("OLLAMA_NUM_PREDICT", 4096);
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      messages: Array<{
        role: string;
        content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
      }>;
      response_format?: { type: string };
    };
    const messages = body.messages.map((message) => {
      if (typeof message.content === "string")
        return { role: message.role, content: message.content };
      const images: string[] = [];
      const text: string[] = [];
      for (const part of message.content) {
        if (part.type === "text") text.push(part.text ?? "");
        else if (part.type === "image_url") {
          const match = part.image_url?.url.match(/^data:image\/[^;]+;base64,(.+)$/s);
          if (!match?.[1]) throw new Error("Local Ollama images must be base64 data URLs.");
          images.push(match[1]);
        } else {
          throw new Error(
            "Local Ollama does not accept PDF file blocks. Import extracted text or Markdown instead.",
          );
        }
      }
      return { role: message.role, content: text.join("\n"), ...(images.length ? { images } : {}) };
    });
    // A conservative byte-level upper bound for text tokenization, plus room
    // for ChatML framing and the full output. Reject instead of letting Ollama
    // silently drop earlier messages/evidence from an oversized text prompt.
    const textBytes = messages.reduce(
      (sum, message) => sum + new TextEncoder().encode(message.content).length,
      0,
    );
    if (textBytes + numPredict + 256 > numCtx) {
      return new Response(
        JSON.stringify({
          error: {
            message:
              "Context length budget exceeded. Shorten the document/wiki context or explicitly increase OLLAMA_NUM_CTX.",
          },
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    const response = await fetch(nativeURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: init?.signal ?? null,
      body: JSON.stringify({
        model: body.model,
        messages,
        stream: false,
        think: false,
        ...(body.response_format ? { format: "json" } : {}),
        options: { num_ctx: numCtx, num_predict: numPredict, temperature: 0 },
      }),
    });
    const result = (await response.json()) as {
      error?: string;
      model?: string;
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
      done_reason?: string;
    };
    if (!response.ok || result.error) {
      return new Response(
        JSON.stringify({ error: { message: result.error || `Ollama HTTP ${response.status}` } }),
        {
          status: response.ok ? 502 : response.status,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return new Response(
      JSON.stringify({
        id: "ollama-local",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: result.model || body.model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: result.message?.content ?? "" },
            finish_reason: result.done_reason || "stop",
          },
        ],
        usage: {
          prompt_tokens: result.prompt_eval_count || 0,
          completion_tokens: result.eval_count || 0,
        },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  };
}

function positiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer`);
  return value;
}
