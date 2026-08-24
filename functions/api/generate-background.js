const MODEL = "gemini-2.5-flash-image";
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1/models/${MODEL}:generateContent`;
const MAX_PROMPT_LENGTH = 1200;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders,
    },
  });
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost(context) {
  const apiKey = context.env.GOOGLE_DEVELOPER_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: "GOOGLE_DEVELOPER_API_KEY is not configured" }, 500);
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON" }, 400);
  }

  const prompt = String(body?.prompt || "").trim();
  if (!prompt) return jsonResponse({ error: "prompt is required" }, 400);
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return jsonResponse({ error: `prompt must be ${MAX_PROMPT_LENGTH} characters or fewer` }, 400);
  }

  // Gemini creates only the ad's background bitmap. The roadside photograph,
  // headline, domain and logo remain deterministic client-side layers.
  const imagePrompt = [
    "Create a premium, high-impact advertising background for a Dutch roadside billboard creative.",
    `Art direction: ${prompt}`,
    "Generate background artwork only: no words, letters, numbers, logos, signs, frames, billboards, mockups or watermarks.",
    "Keep the composition bold and uncluttered with useful negative space for large overlaid copy.",
    "The application will center-crop the result to 5:4 (720 by 576 pixels), so keep important details near the center and away from the outer edges.",
  ].join("\n");

  let response;
  try {
    response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: imagePrompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
        },
      }),
      signal: AbortSignal.timeout(90000),
    });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return jsonResponse(
      { error: timedOut ? "Background generation timed out" : "Could not reach Gemini" },
      502,
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return jsonResponse({ error: "Gemini returned an unreadable response" }, 502);
  }

  if (!response.ok) {
    console.error("[generate-background] Gemini error", response.status, payload?.error?.message);
    return jsonResponse({ error: "Gemini could not generate the background" }, 502);
  }

  const parts = (payload.candidates ?? [])
    .flatMap((candidate) => candidate.content?.parts ?? []);
  const imagePart = parts.find((part) => part.inlineData?.data &&
    /^image\/(png|jpeg|webp)$/i.test(part.inlineData?.mimeType || ""));

  if (!imagePart) {
    const blocked = payload.promptFeedback?.blockReason ||
      payload.candidates?.[0]?.finishReason;
    return jsonResponse({
      error: blocked
        ? `Gemini returned no image (${blocked})`
        : "Gemini returned no image",
    }, 502);
  }

  const mimeType = imagePart.inlineData.mimeType.toLowerCase();
  return jsonResponse({
    ok: true,
    imageDataUrl: `data:${mimeType};base64,${imagePart.inlineData.data}`,
    source: MODEL,
  });
}
