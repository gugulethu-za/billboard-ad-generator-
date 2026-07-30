import json
import logging
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from google import genai
from google.genai import types
from dotenv import load_dotenv
from pydantic import BaseModel, Field, field_validator


BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

logger = logging.getLogger("uvicorn.error")
PREVIEW_FILE = BASE_DIR / "ad-generator_5.preview.html"
MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")


class GenerateCopyRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)

    @field_validator("url")
    @classmethod
    def normalize_url(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("url must not be empty")
        return value


class GenerateCopyResponse(BaseModel):
    lines: list[str] = Field(min_length=2, max_length=2)


class GeminiCopy(BaseModel):
    line1: str = Field(
        min_length=1,
        max_length=45,
        description="De eerste korte Nederlandse billboardregel, maximaal 45 tekens."
    )
    line2: str = Field(
        min_length=1,
        max_length=45,
        description="De tweede korte Nederlandse billboardregel, maximaal 45 tekens."
    )


def parse_gemini_copy(text: str) -> GeminiCopy:
    """Parse structured JSON, tolerating prose or Markdown around the object."""
    try:
        return GeminiCopy.model_validate_json(text)
    except ValueError as direct_error:
        decoder = json.JSONDecoder()
        for index, character in enumerate(text):
            if character != "{":
                continue
            try:
                value, _ = decoder.raw_decode(text[index:])
                return GeminiCopy.model_validate(value)
            except (json.JSONDecodeError, ValueError):
                continue
        raise ValueError("Gemini response did not contain valid copy JSON") from direct_error


app = FastAPI(
    title="OomAgent Billboard Copy API",
    version="1.0.0",
)

# The regex permits common local development origins without opening CORS to
# arbitrary production sites. Requests served by this app are same-origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["null"],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=False,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.get("/", include_in_schema=False)
async def preview() -> FileResponse:
    if not PREVIEW_FILE.is_file():
        raise HTTPException(status_code=404, detail="Frontend preview not found")
    return FileResponse(PREVIEW_FILE)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


def generate_with_gemini(website: str, api_key: str) -> GeminiCopy:
    client = genai.Client(api_key=api_key)
    prompt = f"""
Maak billboardtekst voor het bedrijf of merk achter deze website:
{website}

Schrijf precies twee krachtige Nederlandse reclameregels.
Vereisten:
- Elke regel is maximaal 45 tekens inclusief spaties.
- De regels moeten samen als één korte advertentie werken.
- Gebruik helder, natuurlijk Nederlands.
- Geen hashtags, emoji, aanhalingstekens of uitleg.
- Doe geen feitelijke claims die niet uit de invoer blijken.
- Als alleen een domeinnaam beschikbaar is, baseer je dan voorzichtig op de
  merknaam in het domein en verzin geen specifieke producten of prestaties.
"""

    response = client.models.generate_content(
        model=MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0.8,
            max_output_tokens=512,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
            response_mime_type="application/json",
            response_schema=GeminiCopy,
        ),
    )

    if response.parsed:
        result = response.parsed
        if isinstance(result, GeminiCopy):
            return result
        return GeminiCopy.model_validate(result)

    if response.text:
        return parse_gemini_copy(response.text)

    raise RuntimeError("Gemini returned an empty response")


@app.post("/api/generate-copy", response_model=GenerateCopyResponse)
async def generate_copy(payload: GenerateCopyRequest) -> GenerateCopyResponse:
    api_key = os.getenv("GOOGLE_DEVELOPER_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="GOOGLE_DEVELOPER_API_KEY is not configured on the server",
        )

    try:
        copy = await run_in_threadpool(generate_with_gemini, payload.url, api_key)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "Gemini copy generation failed: error_type=%s error=%s model=%s",
            type(exc).__name__,
            str(exc),
            MODEL,
        )
        # Keep provider details in server logs rather than exposing them to
        # frontend callers.
        raise HTTPException(
            status_code=502,
            detail="Unable to generate billboard copy with Gemini",
        ) from exc

    lines = [copy.line1.strip(), copy.line2.strip()]
    if not all(lines):
        raise HTTPException(status_code=502, detail="Gemini returned incomplete copy")

    return GenerateCopyResponse(lines=lines)
