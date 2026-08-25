const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
  });
}

function isUnsafeHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '::' || /^(fc|fd|fe[89ab])/i.test(host)) return true;
  if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) return true;
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part) || Number(part) > 255)) return false;
  const octets = parts.map(Number);
  return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) || octets[0] >= 224;
}

function normalizeWebsiteUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value || value.length > 2048) throw new Error("Voer een geldige website-URL in.");
  const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("Alleen openbare http- en https-websites zijn toegestaan.");
  if (isUnsafeHostname(url.hostname)) throw new Error("Lokale en priv\u00e9-netwerkadressen zijn niet toegestaan.");
  return url.href;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost(context) {
  const accountId = String(context.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const apiToken = String(context.env.CLOUDFLARE_BROWSER_RENDERING_API_TOKEN || '').trim();
  if (!accountId || !apiToken) return jsonResponse({ ok: false, error: 'Screenshotservice is niet geconfigureerd.' }, 503);
  let websiteUrl;
  try {
    websiteUrl = normalizeWebsiteUrl((await context.request.json())?.url);
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message || 'Ongeldige aanvraag.' }, 400);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    let response;
    const fallbackRetryDelays = [1000, 2000];
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/browser-rendering/screenshot`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: websiteUrl, viewport: { width: 1280, height: 1024 }, screenshotOptions: { type: 'png', fullPage: false }, gotoOptions: { waitUntil: 'networkidle0', timeout: 15000 } }),
        signal: controller.signal,
      });
      if (response.status !== 429 || attempt === 2) break;
      const retryAfterSeconds = Number(response.headers.get('retry-after'));
      const retryInMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.min(retryAfterSeconds * 1000, 5000)
        : fallbackRetryDelays[attempt];
      console.warn('[website-screenshot] rate limited; retrying', {
        attempt: attempt + 1,
        retryAfterHeader: response.headers.get('retry-after'),
        retryInMs,
        websiteUrl,
      });
      await response.arrayBuffer().catch(() => null);
      await delay(retryInMs);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.warn('Browser Run screenshot failed', response.status, detail.slice(0, 500));
      return jsonResponse({ ok: false, error: 'De website-afbeelding kon niet worden gemaakt.' }, 502);
    }
    const contentType = (response.headers.get('content-type') || 'image/png').split(';')[0];
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 8_000_000) return jsonResponse({ ok: false, error: 'De website-afbeelding is ongeldig of te groot.' }, 502);
    return jsonResponse({ ok: true, imageDataUrl: `data:${contentType};base64,${bytesToBase64(bytes)}` });
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return jsonResponse({ ok: false, error: timedOut ? 'Website-afbeelding maken duurde te lang.' : 'De website-afbeelding kon niet worden gemaakt.' }, timedOut ? 504 : 502);
  } finally {
    clearTimeout(timeout);
  }
}
