import os
import logging
import asyncio
from functools import partial

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, HttpUrl

# Try to import from project.rag_analyze, fallback to rag_analyze if running from project dir
try:
    from project.rag_analyze import YouTubeRAG
except ImportError:
    from rag_analyze import YouTubeRAG

# ── Logging ──────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)
logger = logging.getLogger("main")

# ── Paths ─────────────────────────────────────────────────────
# Determine BASE_DIR accurately regardless of how the script is run
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

# ── App ───────────────────────────────────────────────────────
app = FastAPI(title="Video Analyzer")

# CORS — allow all origins for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Global RAG instance ───────────────────────────────────────
rag = YouTubeRAG()

# ── Pydantic models ───────────────────────────────────────────
class AnalyzeRequest(BaseModel):
    url: HttpUrl

class ChatRequest(BaseModel):
    question: str

# ── Response helpers ──────────────────────────────────────────
def ok(data: dict) -> JSONResponse:
    return JSONResponse(content={"success": True, "data": data})

def err(message: str, status: int = 500) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"success": False, "error": message},
    )

# ── API Routes ────────────────────────────────────────────────
# IMPORTANT: Define API routes BEFORE mounting static files to root "/"

@app.get("/health")
async def health_check():
    """Simple health check endpoint."""
    return {"status": "healthy", "frontend_dir": FRONTEND_DIR}

@app.post("/analyze")
async def analyze(request: AnalyzeRequest):
    url = str(request.url)
    logger.info("POST /analyze  url=%s", url)
    loop = asyncio.get_running_loop()
    try:
        data = await loop.run_in_executor(None, partial(rag.analyze_video, url))
        return ok(data)
    except ValueError as ve:
        logger.warning("Validation error: %s", ve)
        return err(str(ve), status=400)
    except Exception as e:
        logger.error("Analysis failed: %s", e, exc_info=True)
        return err("Processing failed — check server logs.", status=500)

@app.post("/chat")
async def chat(request: ChatRequest):
    logger.info("POST /chat  question=%s", request.question)
    loop = asyncio.get_running_loop()
    try:
        answer = await loop.run_in_executor(None, partial(rag.ask, request.question))
        return ok({"answer": answer})
    except Exception as e:
        logger.error("Chat failed: %s", e, exc_info=True)
        return ok({"answer": "Temporary AI issue, please try again"})

# ── Frontend Serving ─────────────────────────────────────────

# Mount the entire frontend directory at root "/"
# This serves index.html at "/" (via html=True) and assets at their relative paths.
if os.path.exists(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
    logger.info("Frontend directory mounted at root: %s", FRONTEND_DIR)
else:
    logger.error("Frontend directory NOT FOUND at: %s", FRONTEND_DIR)

# Fallback for SPA-like behavior or if direct file serving is preferred
@app.get("/")
async def read_index():
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return JSONResponse(status_code=404, content={"detail": "index.html not found"})

