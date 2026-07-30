const MODEL = "gemini-2.5-flash";
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

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
      ...corsHeaders,
    },
  });
}

function parseCopyJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Defensive fallback for model responses wrapped in prose or Markdown.
    for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
      for (let end = text.lastIndexOf("}"); end > start; end = text.lastIndexOf("}", end - 1)) {
        try {
          return JSON.parse(text.slice(start, end + 1));
        } catch {
          // Try the next possible closing brace.
        }
      }
    }
  }
  throw new Error("Gemini response did not contain valid JSON");
}

function extractResponseText(payload) {
  return (payload.candidates ?? [])
    .flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost(context) {
  const apiKey = context.env.GOOGLE_DEVELOPER_API_KEY;
  if (!apiKey) {
    console.error("GOOGLE_DEVELOPER_API_KEY is not configured");
    return jsonResponse(
      { detail: "GOOGLE_DEVELOPER_API_KEY is not configured on the server" },
      503,
    );
  }

  let requestBody;
  try {
    requestBody = await context.request.json();
  } catch (error) {
    return jsonResponse({ detail: "Request body must be valid JSON" }, 400);
  }

  const website = typeof requestBody?.url === "string"
    ? requestBody.url.trim()
    : "";

  if (!website || website.length > 2048) {
    return jsonResponse(
      { detail: "url must be a non-empty string of at most 2048 characters" },
      422,
    );
  }

  const prompt = `
Maak billboardtekst voor het bedrijf of merk achter deze website:
${website}

Schrijf precies twee krachtige Nederlandse reclameregels.
Vereisten:
- Elke regel is maximaal 45 tekens inclusief spaties.
- De regels moeten samen als één korte advertentie werken.
- Gebruik helder, natuurlijk Nederlands.
- Geen hashtags, emoji, aanhalingstekens of uitleg.
- Doe geen feitelijke claims die niet uit de invoer blijken.
- Als alleen een domeinnaam beschikbaar is, baseer je dan voorzichtig op de
  merknaam in het domein en verzin geen specifieke producten of prestaties.
`;

  try {
    const geminiResponse = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 512,
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: "application/json",
          responseJsonSchema: {
            type: "object",
            properties: {
              line1: {
                type: "string",
                description: "De eerste korte Nederlandse billboardregel.",
              },
              line2: {
                type: "string",
                description: "De tweede korte Nederlandse billboardregel.",
              },
            },
            required: ["line1", "line2"],
            additionalProperties: false,
          },
        },
      }),
    });

    const rawResponse = await geminiResponse.text();
    if (!geminiResponse.ok) {
      console.error(
        "Gemini API request failed",
        geminiResponse.status,
        geminiResponse.statusText,
        rawResponse,
      );
      return jsonResponse(
        { detail: "Unable to generate billboard copy with Gemini" },
        502,
      );
    }

    const geminiPayload = JSON.parse(rawResponse);
    const finishReason = geminiPayload.candidates?.[0]?.finishReason;
    const responseText = extractResponseText(geminiPayload);

    if (finishReason && finishReason !== "STOP") {
      throw new Error(`Gemini finish reason: ${finishReason}`);
    }
    if (!responseText) {
      throw new Error("Gemini returned an empty response");
    }

    const copy = parseCopyJson(responseText);
    const lines = [copy.line1, copy.line2].map((line) =>
      typeof line === "string" ? line.trim() : ""
    );

    if (lines.some((line) => !line || line.length > 45)) {
      throw new Error("Gemini returned missing or overlong billboard copy");
    }

    return jsonResponse({ lines });
  } catch (error) {
    console.error(
      "Gemini copy generation failed",
      error?.name ?? "Error",
      error?.message ?? String(error),
      error?.stack ?? "",
    );
    return jsonResponse(
      { detail: "Unable to generate billboard copy with Gemini" },
      502,
    );
  }
}
