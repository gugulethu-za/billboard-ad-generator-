const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files" +
  "?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink";
const MAX_PNG_BYTES = 12 * 1024 * 1024;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function base64Url(value) {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : new Uint8Array(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function pemToArrayBuffer(pem) {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

function decodePng(dataUrl) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl || "");
  if (!match) throw new Error("pngDataUrl must be a base64 PNG data URL");
  const binary = atob(match[1].replace(/\s/g, ""));
  if (!binary.length || binary.length > MAX_PNG_BYTES) {
    throw new Error("PNG is empty or exceeds the 12 MB limit");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function safeFilename(value) {
  const cleaned = String(value || "")
    .replace(/[^a-zA-Z0-9@._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
  const filename = cleaned || `billboard-${Date.now()}.png`;
  return filename.toLowerCase().endsWith(".png") ? filename : `${filename}.png`;
}

async function getAccessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const encodedClaim = base64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: DRIVE_SCOPE,
    aud: credentials.token_uri || TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const unsignedJwt = `${encodedHeader}.${encodedClaim}`;
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(credentials.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(unsignedJwt),
  );
  const assertion = `${unsignedJwt}.${base64Url(signature)}`;
  const response = await fetch(credentials.token_uri || TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) {
    console.error("Google OAuth token request failed", response.status, result.error);
    throw new Error("Unable to authenticate with Google Drive");
  }
  return result.access_token;
}

function multipartBody(metadata, pngBytes, boundary) {
  const encoder = new TextEncoder();
  const prefix = encoder.encode(
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    "Content-Type: image/png\r\n\r\n",
  );
  const suffix = encoder.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(prefix.length + pngBytes.length + suffix.length);
  body.set(prefix, 0);
  body.set(pngBytes, prefix.length);
  body.set(suffix, prefix.length + pngBytes.length);
  return body;
}

export async function onRequestPost(context) {
  const rawCredentials = context.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const folderId = String(context.env.GOOGLE_DRIVE_FOLDER_ID || "").trim();
  if (!rawCredentials || !folderId) {
    return json({ ok: false, error: "Google Drive is not configured" }, 503);
  }

  try {
    const credentials = JSON.parse(rawCredentials);
    if (!credentials.client_email || !credentials.private_key) {
      throw new Error("Service account JSON is missing client_email or private_key");
    }
    const payload = await context.request.json();
    const filename = safeFilename(payload.filename);
    const pngBytes = decodePng(payload.pngDataUrl);
    const accessToken = await getAccessToken(credentials);
    const boundary = `oomagent_billboard_${crypto.randomUUID()}`;
    const body = multipartBody(
      { name: filename, mimeType: "image/png", parents: [folderId] },
      pngBytes,
      boundary,
    );
    const response = await fetch(UPLOAD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    const result = await response.json();
    if (!response.ok) {
      console.error("Google Drive upload failed", response.status, result.error?.message);
      return json({ ok: false, error: "Unable to save the billboard to Google Drive" }, 502);
    }
    return json({ ok: true, file: result });
  } catch (error) {
    console.error("Save-to-Drive failed", error?.message || String(error));
    const isInputError = /pngDataUrl|PNG is empty/.test(error?.message || "");
    return json(
      { ok: false, error: isInputError ? error.message : "Unable to save the billboard to Google Drive" },
      isInputError ? 400 : 500,
    );
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204 });
}
