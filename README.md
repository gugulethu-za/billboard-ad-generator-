# OomAgent billboard generator

Static billboard-builder frontend with Cloudflare Pages Functions for
AI-generated Dutch copy and Google Drive storage. A small FastAPI application
is retained as a local diagnostic/reference implementation of copy generation.

Production deployment details are in
[docs/CLOUDFLARE_DEPLOY.md](docs/CLOUDFLARE_DEPLOY.md).

## Project layout

```text
ad-generator_5.preview.html   Source frontend copied into public/index.html
ad-generator_5.mobile.html    Mobile frontend copied into public/mobile/index.html
bee-hotel-billboard.jpg       Active billboard background
bee-hotel-billboard-v2.jpg    Cropped desktop billboard photograph
oomagent-logo-white.svg       Primary site logo
oomagent-logo-blue.png        Logo fallback
functions/api/                Production Cloudflare API Functions
main.py                       Local FastAPI copy-generation diagnostic
scripts/                      Development and diagnostic utilities
docs/                         Deployment notes and reference artifacts
archive/                      Retained legacy and generated artifacts
public/                       Generated Pages output; ignored by Git
```

## Production API routes

- `POST /api/generate-copy` fetches the submitted public website, extracts
  readable text, and supplies that content to Gemini.
- `POST /api/generate-background` uses Gemini 2.5 Flash Image to create only
  the 720x576 creative background layer. The roadside photograph, copy, domain,
  and logo are never sent to Gemini and remain deterministic browser layers.
- `POST /api/save-to-drive` stores the generated PNG in Google Drive.

Website retrieval has a 15-second network timeout and a 16-second outer limit
in the Python implementation. If retrieval fails, copy generation continues
with a conservative domain-only fallback. The frontend keeps visible progress
feedback active during slower requests and applies a 35-second overall limit.

## Recommended local development: Wrangler

Wrangler exercises the same frontend, Pages Functions, and API paths used in
production. Install a current Node.js release, then create `.dev.vars` in the
repository root with:

```dotenv
GOOGLE_DEVELOPER_API_KEY=your-gemini-key
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
GOOGLE_DRIVE_FOLDER_ID=your-drive-folder-id
CLOUDFLARE_ACCOUNT_ID=your-cloudflare-account-id
CLOUDFLARE_BROWSER_RENDERING_API_TOKEN=your-browser-rendering-api-token
```

Never commit `.dev.vars`; it is ignored.

The Browser Run token needs **Account > Browser Rendering > Edit** permission,
restricted to the Cloudflare account identified by `CLOUDFLARE_ACCOUNT_ID`.
The website screenshot is requested alongside copy generation and analyzed
client-side to choose a prominent, saturated brand color for the billboard's
solid background. Neutral white, black, and gray pixels are ignored. Screenshot
or color-analysis failures fall back silently to neutral grey (`#9CA3AF`)
without preventing copy generation.

Prepare the generated Pages directory in PowerShell:

```powershell
New-Item -ItemType Directory -Force public | Out-Null
New-Item -ItemType Directory -Force public/mobile | Out-Null
Copy-Item ad-generator_5.preview.html public/index.html
Copy-Item ad-generator_5.mobile.html public/mobile/index.html
Copy-Item bee-hotel-billboard.jpg public/bee-hotel-billboard.jpg
Copy-Item bee-hotel-billboard-v2.jpg public/bee-hotel-billboard-v2.jpg
Copy-Item oomagent-logo-white.svg public/oomagent-logo-white.svg
Copy-Item oomagent-logo-blue.png public/oomagent-logo-blue.png
```

Run Pages locally:

```powershell
npx wrangler pages dev public --compatibility-date=2026-08-06
```

Open the local URL printed by Wrangler for desktop, and append `/mobile` for
the dedicated mobile layout. Test copy generation, PNG rendering, automatic
Drive saving after valid copy/email input, and manual submission on both paths.

## FastAPI diagnostic setup

Create and activate a virtual environment:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Set the Gemini key and start the app:

```powershell
$env:GOOGLE_DEVELOPER_API_KEY = "your-key-here"
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Useful endpoints:

- `GET /health`
- `POST /api/generate-copy`
- API docs: <http://127.0.0.1:8000/docs>

Example:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8000/api/generate-copy" `
  -ContentType "application/json" `
  -Body '{"url":"example.nl"}'
```

The FastAPI app is diagnostic rather than a complete replacement for Wrangler:

- It does not implement `/api/save-to-drive`.
- It returns the desktop frontend at `/` and mobile frontend at `/mobile`, but
  does not mount the frontend's image
  assets as static routes.
- Use Wrangler when testing the complete browser workflow.

`GOOGLE_DEVELOPER_API_KEY` is server-only. Do not place secrets in HTML, JSX,
source control, or client-side environment variables. Set `GEMINI_MODEL` to
override the default Gemini model locally.

The key diagnostic script is available at:

```powershell
python scripts/test_gemini_key.py
```

## Verification

Before deployment:

```powershell
node --check functions/api/generate-copy.js
node --check functions/api/generate-background.js
node --check functions/api/save-to-drive.js
python -c "import ast, pathlib; ast.parse(pathlib.Path('main.py').read_text(encoding='utf-8'))"
```

Then rebuild `public/`, run `npx wrangler pages dev public`, and verify both API
routes. See the deployment guide for the exact Cloudflare Pages build command.
