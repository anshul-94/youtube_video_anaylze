"""
rag_service.py — YouTube RAG Pipeline (PyTorch-free)
=====================================================
Root cause of [mutex.cc:452] RAW: Lock blocking:
  HuggingFaceEmbeddings loads PyTorch → PyTorch triggers vecLib/OpenMP
  thread pool initialization → macOS Abseil mutex spin → deadlock log.

Fix: Replace HuggingFaceEmbeddings with a pure sklearn TF-IDF + FAISS
pipeline. No PyTorch, no BLAS, no mutex contention — zero dependency
on native ML thread pools.

Flow:  URL → transcript → TF-IDF chunks → FAISS index
       question → cosine retrieval → OpenRouter LLM → answer
"""

import os
import re
import json
import logging
from typing import Any, Dict, List, Optional

import numpy as np
import requests
from dotenv import load_dotenv
from sklearn.feature_extraction.text import TfidfVectorizer
from youtube_transcript_api import YouTubeTranscriptApi

load_dotenv()
logger = logging.getLogger("rag_service")

# ── Constants ─────────────────────────────────────────────────
CHUNK_SIZE        = 1200        # characters per chunk (larger = more context per chunk)
CHUNK_OVERLAP     = 200         # character overlap between chunks
MAX_TRANSCRIPT_CH = 14_000      # chars sent to LLM for analysis
TOP_K             = 8           # retrieved chunks per question
LLM_TIMEOUT       = 60          # seconds per OpenRouter call
# NOTE: Do NOT use the ':free' suffix — it causes a 404 on some OpenRouter
# endpoint versions. Use the base model name instead.
LLM_MODEL         = "meta-llama/llama-3-8b-instruct"
OPENROUTER_URL    = "https://openrouter.ai/api/v1/chat/completions"

_FALLBACK: Dict[str, Any] = {
    "summary":    "Video processed. Ask me anything about it.",
    "main_topic": "See transcript",
    "motive":     "Unknown",
    "teaching":   "Unknown",
    "key_points": ["Transcript loaded — use chat to explore the content."],
    "learning":   "Ask questions below.",
    "difficulty": "Unknown",
}


class YouTubeRAG:
    # ── Init ──────────────────────────────────────────────────
    def __init__(self) -> None:
        self.api_key: Optional[str] = os.getenv("OPENROUTER_API_KEY")
        if not self.api_key:
            logger.warning("OPENROUTER_API_KEY not set — LLM calls will fail.")

        # State — written by analyze_video, read by ask
        self.chunks: List[str] = []
        self.tfidf: Optional[TfidfVectorizer] = None
        self.matrix: Optional[Any] = None          # sparse TF-IDF matrix
        # Kept for compatibility with main.py guard check
        self.vectorstore: Optional[bool] = None
        self.current_video_id: Optional[str] = None
        logger.info("YouTubeRAG initialised (sklearn TF-IDF mode).")

    # ── 1. URL helpers ────────────────────────────────────────
    @staticmethod
    def extract_video_id(url: str) -> Optional[str]:
        match = re.search(r"(?:v=|youtu\.be/)([0-9A-Za-z_-]{11})", url)
        return match.group(1) if match else None

    @staticmethod
    def _fetch_meta(url: str) -> Dict[str, str]:
        try:
            r = requests.get(
                "https://www.youtube.com/oembed",
                params={"url": url, "format": "json"},
                timeout=10,
            )
            r.raise_for_status()
            d = r.json()
            return {
                "title":   d.get("title", "Unknown Title"),
                "channel": d.get("author_name", "Unknown Channel"),
            }
        except Exception as exc:
            logger.warning("oembed failed: %s", exc)
            return {"title": "Unknown Title", "channel": "Unknown Channel"}

    # ── 2. Transcript ─────────────────────────────────────────
    @staticmethod
    def get_transcript(video_id: str) -> str:
        """
        Fetch transcript in any available language.

        Priority:
          1. English (manual)
          2. Any other manual transcript
          3. Any auto-generated transcript (e.g. Hindi auto-generated)

        Raises ValueError only when NO transcript exists at all.
        """
        api = YouTubeTranscriptApi()

        # -- Tier 1: try plain fetch (youtube-transcript-api picks the
        #            best available language automatically in recent versions)
        try:
            entries = api.fetch(video_id)
            text = " ".join(e.text for e in entries).strip()
            if text:
                logger.info("Transcript fetched (default language).")
                return text
        except Exception as e1:
            logger.debug("Default fetch failed (%s), trying language list.", e1)

        # -- Tier 2 & 3: list all available transcripts and pick one
        try:
            transcript_list = api.list(video_id)

            # Collect: manual transcripts first, then generated ones
            manual    = []
            generated = []
            for t in transcript_list:
                (generated if t.is_generated else manual).append(t)

            ordered = manual + generated          # prefer manual over auto
            if not ordered:
                raise ValueError("No transcripts available.")

            chosen  = ordered[0]
            entries = chosen.fetch()
            text    = " ".join(e.text for e in entries).strip()
            if not text:
                raise ValueError("Fetched transcript is empty.")

            logger.info(
                "Transcript fetched: lang=%s, generated=%s",
                chosen.language_code, chosen.is_generated,
            )
            return text

        except ValueError:
            raise          # re-raise our own "no transcripts" error
        except Exception as exc:
            raise ValueError(
                f"No transcript could be fetched for '{video_id}'. "
                f"The video may be private or have no subtitles at all. ({exc})"
            ) from exc

    # ── 3. Chunking ───────────────────────────────────────────
    @staticmethod
    def chunk_text(text: str) -> List[str]:
        """
        Simple character-based sliding window chunker.
        No external dependency — cannot block or deadlock.
        """
        chunks, start = [], 0
        while start < len(text):
            end = min(start + CHUNK_SIZE, len(text))
            chunks.append(text[start:end])
            start += CHUNK_SIZE - CHUNK_OVERLAP
        if not chunks:
            raise ValueError("Chunking produced zero chunks.")
        logger.info("Split into %d chunks.", len(chunks))
        return chunks

    # ── 4. TF-IDF index ───────────────────────────────────────
    def build_index(self, chunks: List[str]) -> None:
        """Fit TF-IDF on lowercased chunks for better cosine similarity scores."""
        # Lowercase here so the vectorizer vocabulary matches lowercased queries
        lowered = [c.lower() for c in chunks]
        self.tfidf  = TfidfVectorizer(
            ngram_range=(1, 2),
            max_features=20_000,
            sublinear_tf=True,     # log-normalise TF — reduces score dominance by frequent terms
        )
        self.matrix = self.tfidf.fit_transform(lowered)
        self.chunks = chunks        # store ORIGINAL (not lowercased) for LLM context
        # Signal to main.py that a video is loaded
        self.vectorstore = True
        logger.info("TF-IDF index built over %d chunks.", len(chunks))

    # ── 5. Retrieval ──────────────────────────────────────────
    def _expand_query(self, question: str) -> str:
        """
        Since TF-IDF relies on exact keywords, we bridge the Hindi-English
        gap by asking the fast LLM to generate synonyms/translations first.
        """
        messages = [
            {
                "role": "system",
                "content": (
                    "You are a search expansion bot. Generate exactly 15 related keywords, "
                    "synonyms, and context words for the user's query. Include both English "
                    "and Hindi (Romanised) terms. Output ONLY a space-separated list of "
                    "keywords, no punctuation, no intro."
                )
            },
            {"role": "user", "content": question}
        ]
        try:
            expanded = self._llm(messages, extra={"temperature": 0.7})
            clean = expanded.replace("\n", " ")
            logger.info("Query Expansion [%s] -> [%s]", question, clean)
            return f"{question} {clean}"
        except Exception as e:
            logger.warning("Query expansion failed, using raw query: %s", e)
            return question

    def retrieve_context(self, question: str) -> str:
        if self.tfidf is None or self.matrix is None:
            logger.warning("retrieve_context called but index not built.")
            return ""

        # 1. Expand query to catch synonyms / cross-language terms
        expanded_q = self._expand_query(question)

        # 2. Lowercase query to match the lowercased index vocabulary
        q_vec  = self.tfidf.transform([expanded_q.lower()])
        scores = (self.matrix @ q_vec.T).toarray().flatten()

        # Take top-K by score, no threshold — ensures we always return
        # something even when the question uses synonyms/paraphrases.
        top_idx = scores.argsort()[::-1][:TOP_K]
        # Log scores so the user can see retrieval quality
        logger.info(
            "Retrieval scores (top %d): %s",
            TOP_K,
            [(int(i), round(float(scores[i]), 4)) for i in top_idx],
        )
        return "\n\n".join(self.chunks[i] for i in top_idx)

    # ── 6. LLM ───────────────────────────────────────────────
    def _llm(self, messages: List[Dict], extra: Optional[Dict] = None) -> str:
        if not self.api_key:
            raise RuntimeError("OPENROUTER_API_KEY not set.")
        payload: Dict[str, Any] = {"model": LLM_MODEL, "messages": messages}
        if extra:
            payload.update(extra)
        resp = requests.post(
            OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type":  "application/json",
                # Required by OpenRouter — without these the API returns 404/401
                "HTTP-Referer":  "http://localhost:5500",
                "X-Title":       "YouTube Analyzer",
            },
            json=payload,
            timeout=LLM_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError) as exc:
            raise RuntimeError(f"Unexpected LLM response: {data}") from exc

    # ── 7. Chat ───────────────────────────────────────────────
    def ask(self, question: str) -> str:
        if not self.vectorstore:
            raise ValueError("No video loaded. Call /analyze first.")
        context = self.retrieve_context(question)
        # Always send some context — fall back to first few chunks if retrieval blank
        if not context and self.chunks:
            logger.warning("Retrieval returned empty — using first %d chunks as fallback.", TOP_K)
            context = "\n\n".join(self.chunks[:TOP_K])
        if not context:
            return "No transcript content available to answer your question."
        messages = [
            {
                "role": "system",
                "content": (
                    "You are a highly concise AI assistant answering questions about a video. "
                    "STRICT RULES:\n"
                    "1. Give SHORT and PRECISE answers (maximum 3-5 lines).\n"
                    "2. Respond ONLY in simple English, regardless of input/transcript language.\n"
                    "3. ONLY answer what the user asked. DO NOT go off-topic.\n"
                    "4. Focus ONLY on IMPORTANT and CORE information.\n"
                    "5. DO NOT use filler phrases (e.g., 'This video explains...', 'Based on the context...'). Start directly with the answer.\n"
                    "6. Highlight important words using ALL CAPS.\n"
                    "7. If the exact answer is not found, use the broader context to give the best possible educated guess. NEVER say 'no information found'."
                ),
            },
            {
                "role": "user",
                "content": f"Context:\n{context}\n\nQuestion: {question}",
            },
        ]
        try:
            return self._llm(messages)
        except Exception as exc:
            logger.error("LLM chat error: %s", exc)
            raise RuntimeError("LLM call failed.") from exc

    # ── 8. Analysis ───────────────────────────────────────────
    def generate_analysis(self, title: str, channel: str, transcript: str) -> Dict[str, Any]:
        truncated = transcript[:MAX_TRANSCRIPT_CH]
        logger.info("Generating analysis. Transcript chars sent to LLM: %d", len(truncated))

        prompt = (
            f"Video title: {title}\nChannel: {channel}\n\n"
            "Analyze the transcript below. Extract ONLY high-value, CORE insights.\n"
            "Return a JSON object with EXACTLY these keys (no extra text, no markdown):\n"
            '{"summary":"2-3 lines max (core idea only, no filler)",'
            '"main_topic":"1 line",'
            '"motive":"1 line",'
            '"teaching":"2-3 key ideas",'
            '"key_points":["max 5 points (IMPORTANT only)", "..."],'
            '"learning":"2-3 outcomes",'
            '"difficulty":"One word (Beginner/Intermediate/Advanced)"}\n\n'
            f"Transcript:\n{truncated}"
        )
        messages = [
            {
                "role": "system",
                "content": (
                    "You are a strict, highly concise JSON generator. STRICT RULES:\n"
                    "1. Output ONLY a valid JSON object. No explanation, no markdown.\n"
                    "2. Respond ONLY in simple English, regardless of transcript language.\n"
                    "3. Highlight IMPORTANT words using ALL CAPS.\n"
                    "4. DO NOT use filler phrases like 'This video is about'. Start directly with useful info."
                ),
            },
            {"role": "user", "content": prompt},
        ]
        try:
            # NOTE: Do NOT pass response_format — the free Llama model ignores
            # it and sometimes produces malformed output when it tries to comply.
            raw = self._llm(messages)
            logger.info("Raw LLM analysis response (first 300 chars): %s", raw[:300])

            # Robust fence stripping — handles ```json ... ```, ``` ... ```, or plain JSON
            clean = raw.strip()
            if clean.startswith("```"):
                # Remove opening fence (```json or ```)
                clean = clean.split("\n", 1)[1] if "\n" in clean else clean[3:]
            if clean.endswith("```"):
                clean = clean.rsplit("```", 1)[0]
            clean = clean.strip()

            parsed = json.loads(clean)
            logger.info("Analysis JSON parsed successfully.")
            return parsed
        except json.JSONDecodeError as je:
            logger.error("JSON parse failed: %s | raw was: %s", je, raw[:500])
            return dict(_FALLBACK)
        except Exception as exc:
            logger.error("Analysis LLM failed: %s", exc)
            return dict(_FALLBACK)

    # ── 9. Full pipeline ──────────────────────────────────────
    def analyze_video(self, url: str) -> Dict[str, Any]:
        """
        Entry point for POST /analyze.
        Fully synchronous — called via run_in_executor in main.py.
        """
        video_id = self.extract_video_id(url)
        if not video_id:
            raise ValueError("Invalid YouTube URL.")

        meta    = self._fetch_meta(url)
        title   = meta["title"]
        channel = meta["channel"]
        logger.info("Processing '%s' by %s", title, channel)

        transcript = self.get_transcript(video_id)
        logger.info("Transcript length: %d chars", len(transcript))

        chunks = self.chunk_text(transcript)
        logger.info("Chunks created: %d (size=%d, overlap=%d)", len(chunks), CHUNK_SIZE, CHUNK_OVERLAP)

        # Build TF-IDF index first → chat is ready immediately
        self.build_index(chunks)
        self.current_video_id = video_id

        # LLM analysis — always executed, fallback on failure
        analysis = self.generate_analysis(title, channel, transcript)

        result = {"title": title, "channel": channel, **analysis}
        self.current_metadata = result
        logger.info(
            "Video '%s' fully processed. Keys returned: %s",
            video_id, list(result.keys())
        )
        return result
