"""Supported output/UI languages and their mapping to RDF language tags."""

from __future__ import annotations

DEFAULT_LANGUAGE = "ja"
LANGUAGES = ("ja", "en", "ar", "zh-CN")

# API/UI use zh-CN (region); the TTL labels use zh-Hans (script), which is what the text actually is.
RDF_LANG_TAG = {"ja": "ja", "en": "en", "ar": "ar", "zh-CN": "zh-Hans"}

# Names used inside the agent prompts.
PROMPT_LANGUAGE_NAME = {
    "ja": "Japanese",
    "en": "English",
    "ar": "Modern Standard Arabic",
    "zh-CN": "Simplified Chinese (zh-CN)",
}


def is_supported(lang: object) -> bool:
    return isinstance(lang, str) and lang in LANGUAGES
