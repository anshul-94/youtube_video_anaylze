import os
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["VECLIB_MAXIMUM_THREADS"] = "1"
os.environ["NUMEXPR_NUM_THREADS"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

import logging
import asyncio
from functools import partial

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, HttpUrl

from project.rag_analyze import YouTubeRAG

# ── Logging ──────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)
logger = logging.getLogger("main")

# ── Paths ─────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

# ── App ───────────────────────────────────────────────────────
app = FastAPI(title="Video Analyzer")

# Static mounting (must be before or after routes, usually after catch-all or specific)
# We mount it to /static so it doesn't conflict with root /
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

# CORS — allow all origins (safe for local development)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # tighten to specific origins in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Global RAG instance ───────────────────────────────────────
# Mutated only by /analyze (slow, serialised in practice).
# Reads in /chat are GIL-safe. No threading.Lock required.
rag = YouTubeRAG()


# ── Frontend Routes ──────────────────────────────────────────
@app.get("/")
async def read_index():
    """Serve the main index.html file."""
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


@app.get("/health")
async def health_check():
    """Simple health check endpoint."""
    return {"status": "healthy"}


# ── Pydantic models ───────────────────────────────────────────
class AnalyzeRequest(BaseModel):
    url: HttpUrl


class ChatRequest(BaseModel):
    question: str


# ── Response helpers ──────────────────────────────────────────
def ok(data: dict) -> JSONResponse:
    """Wrap successful payloads in the standard envelope."""
    return JSONResponse(content={"success": True, "data": data})


def err(message: str, status: int = 500) -> JSONResponse:
    """Wrap error payloads in the standard envelope."""
    return JSONResponse(
        status_code=status,
        content={"success": False, "error": message},
    )


# ── Routes ────────────────────────────────────────────────────
@app.post("/analyze")
async def analyze(request: AnalyzeRequest):
    """
    Offloads the entire RAG pipeline (transcript → chunks → FAISS → LLM)
    to the default ThreadPoolExecutor via run_in_executor so the asyncio
    event loop is never blocked.
    """
    url = str(request.url)
    logger.info("POST /analyze  url=%s", url)
    loop = asyncio.get_running_loop()          # correct API for use inside async
    try:
        data = await loop.run_in_executor(None, partial(rag.analyze_video, url))
        logger.info("Video processed successfully")
        return ok(data)
    except ValueError as ve:
        logger.warning("Validation error: %s", ve)
        return err(str(ve), status=400)
    except Exception as e:
        logger.error("Analysis failed: %s", e, exc_info=True)
        return err("Processing failed — check server logs.", status=500)


@app.post("/chat")
async def chat(request: ChatRequest):
    """
    Offloads retrieval + LLM call to the thread pool.
    """
    logger.info("POST /chat  question=%s", request.question)
    loop = asyncio.get_running_loop()
    try:
        answer = await loop.run_in_executor(None, partial(rag.ask, request.question))
        logger.info("Chat response generated")
        return ok({"answer": answer})
    except ValueError as ve:
        # Fallback to general AI message if validation somehow fails gracefully
        logger.warning("Validation error: %s", ve)
        return ok({"answer": "Temporary AI issue, please try again"})
    except Exception as e:
        logger.error("Chat failed: %s", e, exc_info=True)
        return ok({"answer": "Temporary AI issue, please try again"})
