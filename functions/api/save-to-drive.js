const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files" +
  "?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink";
const MAX_PNG_BYTES = 12 * 1024 * 1024;

class DriveUploadError extends Error {
  constructor(stage, message, details = {}) {
    super(message);
    this.name = "DriveUploadError";
    this.stage = stage;
    this.details = details;
  }
}

function logFailure(requestId, error, extra = {}) {
  console.error("[save-to-drive] failed", {
    requestId,
    stage: error?.stage || "unexpected",
    name: error?.name || "Error",
    message: error?.message || String(error),
    details: error?.details || undefined,
    ...extra,
  });
}

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
  let privateKey;
  try {
    privateKey = await crypto.subtle.importKey(
      "pkcs8",
      pemToArrayBuffer(credentials.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch (error) {
    throw new DriveUploadError("private-key", "The service-account private key could not be imported", {
      cause: error?.message || String(error),
      hasPemHeader: credentials.private_key.includes("BEGIN PRIVATE KEY"),
      hasPemFooter: credentials.private_key.includes("END PRIVATE KEY"),
    });
  }
  let signature;
  try {
    signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(unsignedJwt),
    );
  } catch (error) {
    throw new DriveUploadError("jwt-signing", "The service-account JWT could not be signed", {
      cause: error?.message || String(error),
    });
  }
  const assertion = `${unsignedJwt}.${base64Url(signature)}`;
  let response;
  try {
    response = await fetch(credentials.token_uri || TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
  } catch (error) {
    throw new DriveUploadError("auth-network", "Google OAuth request could not be sent", {
      cause: error?.message || String(error),
    });
  }
  const rawResult = await response.text();
  let result;
  try {
    result = JSON.parse(rawResult);
  } catch {
    throw new DriveUploadError("auth-response", "Google OAuth returned non-JSON data", {
      httpStatus: response.status,
      responsePreview: rawResult.slice(0, 500),
    });
  }
  if (!response.ok || !result.access_token) {
    throw new DriveUploadError("auth", "Google OAuth rejected the service-account credentials", {
      httpStatus: response.status,
      googleError: result.error,
      googleErrorDescription: result.error_description,
    });
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
  const requestId = crypto.randomUUID();
  const rawCredentials = context.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const folderId = String(context.env.GOOGLE_DRIVE_FOLDER_ID || "").trim();
  if (!rawCredentials || !folderId) {
    const missing = [
      !rawCredentials ? "GOOGLE_SERVICE_ACCOUNT_JSON" : null,
      !folderId ? "GOOGLE_DRIVE_FOLDER_ID" : null,
    ].filter(Boolean);
    logFailure(requestId, new DriveUploadError(
      "configuration",
      `Missing Cloudflare binding(s): ${missing.join(", ")}`,
    ));
    return json({ ok: false, error: "Google Drive is not configured", requestId }, 503);
  }

  try {
    let credentials;
    try {
      credentials = JSON.parse(rawCredentials);
    } catch (error) {
      throw new DriveUploadError("credentials-json", "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON", {
        cause: error?.message || String(error),
        valueLength: String(rawCredentials).length,
      });
    }
    if (!credentials.client_email || !credentials.private_key) {
      throw new DriveUploadError(
        "credentials-fields",
        "Service-account JSON is missing client_email or private_key",
        {
          hasClientEmail: Boolean(credentials.client_email),
          hasPrivateKey: Boolean(credentials.private_key),
          credentialType: credentials.type,
        },
      );
    }
    let payload;
    try {
      payload = await context.request.json();
    } catch (error) {
      throw new DriveUploadError("request-json", "Request body is not valid JSON", {
        cause: error?.message || String(error),
      });
    }
    const filename = safeFilename(payload.filename);
    let pngBytes;
    try {
      pngBytes = decodePng(payload.pngDataUrl);
    } catch (error) {
      throw new DriveUploadError("request-png", error.message);
    }
    console.log("[save-to-drive] starting", {
      requestId,
      filename,
      pngBytes: pngBytes.byteLength,
      folderIdSuffix: folderId.slice(-6),
      serviceAccount: credentials.client_email,
    });
    const accessToken = await getAccessToken(credentials);
    const boundary = `oomagent_billboard_${crypto.randomUUID()}`;
    const body = multipartBody(
      { name: filename, mimeType: "image/png", parents: [folderId] },
      pngBytes,
      boundary,
    );
    let response;
    try {
      response = await fetch(UPLOAD_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      });
    } catch (error) {
      throw new DriveUploadError("upload-network", "Google Drive upload request could not be sent", {
        cause: error?.message || String(error),
      });
    }
    const rawResult = await response.text();
    let result;
    try {
      result = JSON.parse(rawResult);
    } catch {
      throw new DriveUploadError("upload-response", "Google Drive returned non-JSON data", {
        httpStatus: response.status,
        responsePreview: rawResult.slice(0, 1000),
      });
    }
    if (!response.ok) {
      throw new DriveUploadError("upload", "Google Drive rejected the file upload", {
        httpStatus: response.status,
        googleCode: result.error?.code,
        googleStatus: result.error?.status,
        googleMessage: result.error?.message,
        googleReasons: result.error?.errors?.map((item) => item.reason),
        folderIdSuffix: folderId.slice(-6),
      });
    }
    console.log("[save-to-drive] success", {
      requestId,
      fileId: result.id,
      filename: result.name,
    });
    return json({ ok: true, file: result, requestId });
  } catch (error) {
    logFailure(requestId, error);
    const isInputError = ["request-json", "request-png"].includes(error?.stage);
    return json(
      {
        ok: false,
        error: isInputError ? error.message : "Unable to save the billboard to Google Drive",
        stage: error?.stage || "unexpected",
        requestId,
      },
      isInputError ? 400 : 500,
    );
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204 });
}
