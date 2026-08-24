const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";

class DriveDeleteError extends Error {
  constructor(stage, message, details = {}) {
    super(message);
    this.name = "DriveDeleteError";
    this.stage = stage;
    this.details = details;
  }
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

async function getAccessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: DRIVE_SCOPE,
    aud: credentials.token_uri || TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const unsignedJwt = `${header}.${claim}`;
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
    throw new DriveDeleteError("private-key", "Service-account key import failed", {
      cause: error?.message || String(error),
    });
  }
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
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) {
    throw new DriveDeleteError("auth", "Google OAuth rejected the service account", {
      httpStatus: response.status,
      googleError: result.error,
    });
  }
  return result.access_token;
}

export async function onRequestPost(context) {
  const requestId = crypto.randomUUID();
  const rawCredentials = context.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const folderId = String(context.env.GOOGLE_DRIVE_FOLDER_ID || "").trim();
  if (!rawCredentials || !folderId) {
    return json({ ok: false, error: "Google Drive is not configured", requestId }, 503);
  }

  try {
    let credentials;
    try {
      credentials = JSON.parse(rawCredentials);
    } catch {
      throw new DriveDeleteError("credentials-json", "Service-account JSON is invalid");
    }
    if (!credentials.client_email || !credentials.private_key) {
      throw new DriveDeleteError("credentials-fields", "Service-account credentials are incomplete");
    }

    let payload;
    try {
      payload = await context.request.json();
    } catch {
      throw new DriveDeleteError("request-json", "Request body must be valid JSON");
    }
    const fileId = String(payload?.fileId || "").trim();
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) {
      throw new DriveDeleteError("request-file-id", "A valid Drive file ID is required");
    }

    const accessToken = await getAccessToken(credentials);
    const headers = { Authorization: `Bearer ${accessToken}` };
    const metadataUrl = `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}` +
      "?fields=id,name,parents,trashed,driveId,capabilities(canDelete,canTrash)" +
      "&supportsAllDrives=true";
    const metadataResponse = await fetch(metadataUrl, { headers });
    const metadata = await metadataResponse.json().catch(() => ({}));
    if (metadataResponse.status === 404) {
      throw new DriveDeleteError("not-found", "The saved billboard no longer exists");
    }
    if (!metadataResponse.ok) {
      throw new DriveDeleteError("metadata", "Google Drive could not verify the billboard", {
        httpStatus: metadataResponse.status,
        googleMessage: metadata.error?.message,
      });
    }
    if (metadata.trashed || !Array.isArray(metadata.parents) || !metadata.parents.includes(folderId)) {
      throw new DriveDeleteError(
        "folder-check",
        "The requested file is not an active billboard in the configured Drive folder",
      );
    }
    if (metadata.capabilities?.canDelete !== true) {
      throw new DriveDeleteError(
        "delete-permission",
        "The Drive service account cannot permanently delete files from this folder",
        {
          driveId: metadata.driveId,
          canDelete: metadata.capabilities?.canDelete,
          canTrash: metadata.capabilities?.canTrash,
        },
      );
    }

    const deleteResponse = await fetch(
      `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
      { method: "DELETE", headers },
    );
    if (!deleteResponse.ok) {
      const result = await deleteResponse.json().catch(() => ({}));
      throw new DriveDeleteError("delete", "Google Drive could not delete the billboard", {
        httpStatus: deleteResponse.status,
        googleMessage: result.error?.message,
      });
    }

    console.log("[delete-billboard] success", { requestId, fileId, name: metadata.name });
    return json({ ok: true, fileId, requestId });
  } catch (error) {
    console.error("[delete-billboard] failed", {
      requestId,
      stage: error?.stage || "unexpected",
      message: error?.message || String(error),
      details: error?.details,
    });
    const inputError = ["request-json", "request-file-id"].includes(error?.stage);
    const notFound = error?.stage === "not-found";
    const forbidden = error?.stage === "folder-check";
    const permissionDenied = error?.stage === "delete-permission";
    const safeError = inputError || notFound
      ? error.message
      : forbidden
        ? "Dit bestand hoort niet bij de opgeslagen billboards."
        : permissionDenied
          ? "Google Drive staat verwijderen niet toe. Geef het serviceaccount de rol Manager voor deze gedeelde Drive."
        : "Het billboard kon niet uit Google Drive worden verwijderd.";
    return json(
      { ok: false, error: safeError, stage: error?.stage || "unexpected", requestId },
      inputError ? 400 : notFound ? 404 : forbidden || permissionDenied ? 403 : 500,
    );
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204 });
}
