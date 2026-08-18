import os
import traceback
from pathlib import Path

from dotenv import load_dotenv
from google import genai


def main() -> None:
    env_file = Path(__file__).resolve().parent.parent / ".env"
    load_dotenv(env_file)

    api_key = os.getenv("GOOGLE_DEVELOPER_API_KEY")
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

    if not api_key:
        raise SystemExit(
            f"GOOGLE_DEVELOPER_API_KEY was not found in {env_file}"
        )

    if len(api_key) < 10:
        masked_key = "[value is unexpectedly shorter than 10 characters]"
    else:
        masked_key = f"{api_key[:6]}...{api_key[-4:]}"

    print(f"Loaded key: {masked_key}")
    print(f"Key length: {len(api_key)} characters")
    print(f"Model: {model}")

    try:
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=model,
            contents="Say hello.",
        )
        print("Gemini response:")
        print(response.text)
    except Exception as exc:
        print("Gemini request failed:")
        print(f"Type: {type(exc).__name__}")
        print(f"Message: {exc}")
        print("Full traceback:")
        traceback.print_exc()
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
