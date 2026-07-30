# OomAgent billboard generator

This folder contains a static billboard-generator preview and a small FastAPI
backend for AI-generated Dutch billboard copy.

For the production Cloudflare Pages deployment, use the serverless Function and
instructions in [CLOUDFLARE_DEPLOY.md](CLOUDFLARE_DEPLOY.md). The Python backend
below remains available only as a local diagnostic/reference implementation.

## Local setup (PowerShell)

Create and activate a virtual environment:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Set the Gemini API key for the current terminal session:

```powershell
$env:GOOGLE_DEVELOPER_API_KEY = "your-key-here"
```

Start the app:

```powershell
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8000/>. Serving the preview through FastAPI makes its
relative `POST /api/generate-copy` request same-origin.

Useful endpoints:

- `GET /health`
- `POST /api/generate-copy`
- Interactive API docs: <http://127.0.0.1:8000/docs>

Example request:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8000/api/generate-copy" `
  -ContentType "application/json" `
  -Body '{"url":"example.nl"}'
```

The response shape is:

```json
{
  "lines": [
    "Een korte Nederlandse regel.",
    "Nog een krachtige regel."
  ]
}
```

`GOOGLE_DEVELOPER_API_KEY` is read only by the backend. Do not put it in the
HTML, JSX, source control, or any client-side environment variable.

To use a different Gemini model without changing code, set `GEMINI_MODEL`.
