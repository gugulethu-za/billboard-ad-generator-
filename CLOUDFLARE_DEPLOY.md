# Deploy as one Cloudflare Pages project

The existing HTML remains unchanged. During each Pages build it is copied to
`public/index.html`. The Function in `functions/api/generate-copy.js` is
automatically routed to `POST /api/generate-copy`.

## 1. Put the project in GitHub

Create a GitHub repository if one does not exist, commit these project files,
and push the production branch. Do not commit `.env`; it is ignored.

At minimum, the repository must include:

- `ad-generator_5.preview.html`
- `functions/api/generate-copy.js`
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
     `mkdir -p public && cp ad-generator_5.preview.html public/index.html && cp oomagent-logo-white.svg public/oomagent-logo-white.svg && cp oomagent-logo-blue.png public/oomagent-logo-blue.png && cp bee-hotel-billboard.jpg public/bee-hotel-billboard.jpg`
   - **Build output directory:** `public`
   - **Root directory:** leave blank (repository root)

7. Select **Save and Deploy**.

The `functions` directory must stay at repository root, not inside `public`.

## 3. Add the Gemini key

After the project exists:

1. Open the Pages project.
2. Go to **Settings** > **Variables and Secrets**.
3. Select **Add**.
4. Choose an encrypted **Secret** when the dashboard offers the choice.
5. Enter the name `GOOGLE_DEVELOPER_API_KEY`.
6. Paste the Gemini API key as its value and save it.
7. Add it to both **Production** and **Preview** if branch-preview deployments
   should also generate copy.
8. Trigger a new deployment from **Deployments** > **Retry deployment**, or
   push another commit.

The key is available only to the Function as
`context.env.GOOGLE_DEVELOPER_API_KEY`; it is never built into the HTML.

## 4. Verify

Open the generated `https://<project>.pages.dev/` URL. Enter a real domain and
generate copy. The browser should call the same-origin endpoint:

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
