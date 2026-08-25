import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { onRequestPost } from '../functions/api/website-screenshot.js';

const envText = ['.env', '.dev.vars']
  .filter((file) => fs.existsSync(file))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');

for (const line of envText.split(/\r?\n/)) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (!match) continue;
  const key = match[1].trim();
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  process.env[key] = value;
}

const url = process.argv[2] || 'https://oomagent.ai';
const count = Number(process.argv[3] || 3);
const cacheBust = process.argv.includes('--cache-bust');

for (let requestNumber = 1; requestNumber <= count; requestNumber++) {
  const requestUrl = new URL(url);
  if (cacheBust) requestUrl.searchParams.set('_brand_color_probe', `${Date.now()}-${requestNumber}`);
  const started = Date.now();
  const response = await onRequestPost({
    env: process.env,
    request: new Request('http://local/api/website-screenshot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: requestUrl.href }),
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.imageDataUrl) throw new Error(`Request ${requestNumber}: ${data.error || response.status}`);
  const bytes = Buffer.from(data.imageDataUrl.split(',')[1], 'base64');
  const outputPath = path.join(os.tmpdir(), `oomagent-brand-color-${requestNumber}.png`);
  fs.writeFileSync(outputPath, bytes);
  console.log(JSON.stringify({
    requestNumber,
    requestUrl: requestUrl.href,
    elapsedMs: Date.now() - started,
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    outputPath,
  }));
}
