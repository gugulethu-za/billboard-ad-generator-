# Deploy as one Cloudflare Pages project

The desktop HTML is copied to `public/index.html` and the dedicated mobile HTML
is copied to `public/mobile/index.html`. The Function in
`functions/api/generate-copy.js` is automatically routed to
`POST /api/generate-copy`.

## 1. Put the project in GitHub

Create a GitHub repository if one does not exist, commit these project files,
and push the production branch. Do not commit `.env`; it is ignored.

At minimum, the repository must include:

- `ad-generator_5.preview.html`
- `ad-generator_5.mobile.html`
- `bee-hotel-billboard.jpg`
- `bee-hotel-billboard-v2.jpg`
- `oomagent-logo-white.svg`
- `oomagent-logo-blue.png`
- `functions/api/generate-copy.js`
- `functions/api/save-to-drive.js`
- `.gitignore`

The Python files may remain for local/reference use. They are not used or
published by Cloudflare.

## 2. Connect it to Cloudflare Pages

1. Sign in to the Cloudflare dashboard.
2. Open **Workers & Pages**.
3. Select **Create application** > **Pages** > **Connect to Git**.
4. Authorize GitHub and select this repository.
5. Choose the production branch, normally `main`.
6. Use these build settings:

   - **Framework preset:** None
   - **Build command:**
     `mkdir -p public/mobile && cp ad-generator_5.preview.html public/index.html && cp ad-generator_5.mobile.html public/mobile/index.html && cp oomagent-logo-white.svg public/oomagent-logo-white.svg && cp oomagent-logo-blue.png public/oomagent-logo-blue.png && cp bee-hotel-billboard.jpg public/bee-hotel-billboard.jpg && cp bee-hotel-billboard-v2.jpg public/bee-hotel-billboard-v2.jpg`
   - **Build output directory:** `public`
   - **Root directory:** leave blank (repository root)

7. Select **Save and Deploy**.

The `functions` directory must stay at repository root, not inside `public`.

## 3. Add the required secrets and variables

After the project exists:

1. Open the Pages project.
2. Go to **Settings** > **Variables and Secrets**.
3. Select **Add**.
4. Choose an encrypted **Secret** when the dashboard offers the choice.
5. Add these values:
   - `GOOGLE_DEVELOPER_API_KEY`: encrypted Gemini API key.
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: encrypted complete Google service-account
     JSON used by the Drive upload Function.
   - `GOOGLE_DRIVE_FOLDER_ID`: ID of the target Google Drive folder. Share that
     folder with the service account's email address. For permanent billboard
     deletion in a Shared Drive, give the service account the **Manager** role;
     lower roles can upload but do not have `capabilities.canDelete`.
6. Add them to both **Production** and **Preview** if branch-preview deployments
   should also generate copy.
7. Trigger a new deployment from **Deployments** > **Retry deployment**, or
   push another commit.

The key is available only to the Function as
`context.env.GOOGLE_DEVELOPER_API_KEY`; it is never built into the HTML.
Drive credentials are likewise available only to the server-side Function.

## 4. Verify

Open both `https://<project>.pages.dev/` and
`https://<project>.pages.dev/mobile`. Enter a real domain and generate copy.
Both frontends should call the same-origin endpoint:

`POST https://<project>.pages.dev/api/generate-copy`

You can also test it directly:

```bash
curl -X POST "https://<project>.pages.dev/api/generate-copy" \
  -H "Content-Type: application/json" \
  --data '{"url":"oomagent.ai"}'
```

Expected shape:

```json
{"lines":["Eerste Nederlandse regel","Tweede Nederlandse regel"]}
```

For a 502 response, open the Pages project and inspect the Function logs. The
Function logs Gemini's HTTP status/body or JavaScript exception while returning
only a generic error to the browser.
