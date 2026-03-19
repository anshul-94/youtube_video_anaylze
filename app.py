import os
import json
import requests
from flask import Flask, request, jsonify, render_template
import logging
from typing import Optional, Dict, Any
from urllib.parse import urlparse, parse_qs

from youtube_transcript_api import YouTubeTranscriptApi
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import SentenceTransformerEmbeddings
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableParallel, RunnablePassthrough
from langchain_core.output_parsers import StrOutputParser
from langchain_core.documents import Document

# ---- Configuration ----
API_KEY = "sk-or-v1-ef341aa5da86c2b9b767f998dfca59ee4c56ed925592b51cfb5cd8003cf4ddc"
MODEL = "deepseek/deepseek-chat"
ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
    "HTTP-Referer": "http://localhost:5000",
    "X-Title": "YouTube QA Assistant"
}

class DeepSeekLLM:
    def __init__(self, max_retries: int = 3):
        self.max_retries = max_retries
    
    def invoke(self, prompt: str) -> str:
        # Coerce prompt to plain string if it's a prompt-like object (e.g., ChatPromptValue)
        if not isinstance(prompt, str):
            try:
                prompt = getattr(prompt, 'value', None) or getattr(prompt, 'text', None) or str(prompt)
            except Exception:
                prompt = str(prompt)

        for attempt in range(self.max_retries):
            try:
                payload = {
                    "model": MODEL,
                    "messages": [
                        {
                            "role": "system", 
                            "content": "You are a helpful assistant that answers questions based on provided context. Be concise and accurate."
                        },
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.2,
                    "max_tokens": 1000
                }
                
                response = requests.post(
                    ENDPOINT, 
                    headers=headers, 
                    data=json.dumps(payload),
                    timeout=30
                )
                response.raise_for_status()
                
                result = response.json()
                return result["choices"][0]["message"]["content"]
                
            except requests.exceptions.RequestException as e:
                logger.error(f"Attempt {attempt + 1} failed: {e}")
                if attempt == self.max_retries - 1:
                    return f"Error: Unable to get response from AI service. Please try again later. Details: {str(e)}"
                
            except (KeyError, IndexError) as e:
                logger.error(f"Invalid response format: {e}")
                return "Error: Invalid response from AI service."

    def __call__(self, input_text: str) -> str:
        return self.invoke(input_text)

def extract_video_id(url: str) -> Optional[str]:
    """Extract video ID from YouTube URL"""
    try:
        # Handle various YouTube URL formats
        if "youtu.be" in url:
            return url.split("/")[-1].split("?")[0]
        elif "youtube.com" in url:
            parsed_url = urlparse(url)
            if parsed_url.hostname in ("www.youtube.com", "youtube.com"):
                if parsed_url.path == "/watch":
                    return parse_qs(parsed_url.query).get("v", [None])[0]
                elif parsed_url.path.startswith("/embed/"):
                    return parsed_url.path.split("/")[2]
                elif parsed_url.path.startswith("/v/"):
                    return parsed_url.path.split("/")[2]
        return None
    except Exception as e:
        logger.error(f"Error extracting video ID: {e}")
        return None

def get_youtube_transcript(video_id: str) -> Optional[list]:
    """Get YouTube transcript using youtube-transcript-api - FIXED VERSION"""
    try:
        # Instantiate API and get the transcript - fetch() is an instance method in
        # many installed versions, so call it on an instance.
        try:
            api = YouTubeTranscriptApi()
        except Exception:
            api = None

        transcript_data = None
        if api is not None and hasattr(api, "fetch"):
            try:
                transcript_data = api.fetch(video_id, languages=['en'])
            except TypeError:
                # some signatures don't accept languages
                transcript_data = api.fetch(video_id)
            except Exception as e:
                logger.debug(f"Instance fetch failed: {e}")

        # As a last resort, try class-level fetch (unlikely to work if it's an
        # instance method)
        if transcript_data is None and hasattr(YouTubeTranscriptApi, "fetch"):
            try:
                transcript_data = YouTubeTranscriptApi.fetch(video_id, languages=['en'])
            except TypeError:
                try:
                    transcript_data = YouTubeTranscriptApi.fetch(video_id)
                except Exception as e:
                    logger.debug(f"Class fetch fallback failed: {e}")
            except Exception as e:
                logger.debug(f"Class fetch failed: {e}")

        if transcript_data is None:
            logger.error("Unable to obtain transcript data from YouTubeTranscriptApi")
            return None
        
        # Convert to the expected format
        formatted_transcript = []
        for snippet in transcript_data:
            # snippet may be a dict-like or an object with attributes
            text = ''
            start = None
            duration = None
            if isinstance(snippet, dict):
                text = snippet.get('text', '')
                start = snippet.get('start')
                duration = snippet.get('duration')
            else:
                text = getattr(snippet, 'text', '')
                start = getattr(snippet, 'start', None)
                duration = getattr(snippet, 'duration', None)

            formatted_transcript.append({
                'text': text,
                'start': start,
                'duration': duration
            })
        
        return formatted_transcript
    except Exception as e:
        logger.error(f"Error getting transcript: {e}")
        return None

# Initialize LLM
llm = DeepSeekLLM()

app = Flask(__name__)

class VectorStoreManager:
    def __init__(self):
        self.vector_db = None
        self.retriever = None
        self.rag_chain = None
        self.current_video_info = None
    
    def initialize_rag_chain(self, retriever):
        """Initialize the RAG chain with improved prompt"""
        prompt = ChatPromptTemplate.from_template("""
You are a helpful AI assistant that answers questions about a YouTube video using ONLY the transcript content provided.

CONTEXT FROM VIDEO TRANSCRIPT:
{context}

USER QUESTION: {question}

INSTRUCTIONS:
1. Answer the question using ONLY the information from the transcript context above
2. If the question cannot be answered from the transcript, say: "The video does not mention this topic."
3. Be specific and factual - cite details from the transcript when possible
4. Keep your answer concise but informative
5. Do not make up information or use external knowledge

ANSWER:
""")
        self.rag_chain = (
            RunnableParallel({
                "context": retriever, 
                "question": RunnablePassthrough()
            })
            | prompt
            | llm
            | StrOutputParser()
        )

manager = VectorStoreManager()

@app.route("/")
def home():
    return render_template("index.html")

def process_youtube(url: str) -> Dict[str, Any]:
    """Process YouTube video and return results with error handling"""
    try:
        logger.info(f"Processing YouTube video: {url}")
        
        # Extract video ID
        video_id = extract_video_id(url)
        if not video_id:
            return {"error": "Invalid YouTube URL. Please provide a valid YouTube video URL."}
        
        # Get transcript
        transcript_data = get_youtube_transcript(video_id)
        if not transcript_data:
            return {"error": "No English transcript available for this video. Please try a different video."}
        
        # Convert transcript to text - FIXED: Access the text property correctly
        transcript_text = " ".join([entry['text'] for entry in transcript_data])
        
        if not transcript_text.strip():
            return {"error": "Transcript is empty. Please try a different video."}
        
        # Create document
        doc = Document(
            page_content=transcript_text,
            metadata={
                "video_id": video_id,
                "source": url,
                "title": f"YouTube Video {video_id}"
            }
        )
        
        # Split into chunks
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000, 
            chunk_overlap=100,
            separators=["\n\n", "\n", ". ", "! ", "? ", " ", ""]
        )
        chunks = splitter.split_documents([doc])
        
        # Create embeddings and vector store
        embedder = SentenceTransformerEmbeddings(model_name="all-MiniLM-L6-v2")
        
        manager.vector_db = FAISS.from_documents(chunks, embedder)
        manager.retriever = manager.vector_db.as_retriever(
            search_type="similarity",
            search_kwargs={"k": 4}
        )
        
        # Initialize RAG chain
        manager.initialize_rag_chain(manager.retriever)
        manager.current_video_info = {
            "video_id": video_id,
            "url": url,
            "chunks": len(chunks),
            "transcript_length": len(transcript_text)
        }
        
        logger.info(f"Successfully processed video. Created {len(chunks)} chunks.")
        
        return {
            "success": True,
            "chunks": len(chunks),
            "video_info": manager.current_video_info
        }
        
    except Exception as e:
        logger.error(f"Unexpected error processing video: {e}")
        return {"error": f"Unexpected error: {str(e)}"}

def ask_question(question: str) -> str:
    """Ask question with proper error handling"""
    if manager.rag_chain is None:
        return "Please submit a YouTube video first to initialize the system."
    
    if not question or not question.strip():
        return "Please provide a valid question."
    
    try:
        logger.info(f"Processing question: {question}")
        result = manager.rag_chain.invoke(question.strip())
        # The runnable chain may return non-JSON-serializable objects
        # (e.g., ChatPromptValue). Coerce to string for the API response.
        try:
            if isinstance(result, str):
                answer = result
            else:
                # attempt to extract common attributes, then fallback to str()
                answer = getattr(result, 'value', None) or getattr(result, 'text', None) or str(result)
            logger.debug(f"ask_question result type: {type(result)}, coerced to string length {len(answer)}")
            return answer
        except Exception as e:
            logger.debug(f"Failed to coerce chain result to string: {e}")
            return str(result)
    except Exception as e:
        logger.error(f"Error processing question: {e}")
        return f"Error processing your question: {str(e)}"

@app.route("/submit", methods=["POST"])
def submit_video():
    """Submit YouTube video for processing"""
    try:
        data = request.get_json()
        if not data or "url" not in data:
            return jsonify({"error": "No URL provided"}), 400
        
        url = data["url"].strip()
        if not url:
            return jsonify({"error": "Empty URL provided"}), 400
        
        result = process_youtube(url)
        
        if "error" in result:
            return jsonify({"error": result["error"]}), 400
        
        return jsonify({
            "ok": True, 
            "chunks": result["chunks"],
            "video_info": result["video_info"]
        })
        
    except Exception as e:
        logger.error(f"Error in /submit endpoint: {e}")
        return jsonify({"error": "Internal server error"}), 500

@app.route("/ask", methods=["POST"])
def ask():
    """Ask question about the current video"""
    try:
        data = request.get_json()
        if not data or "question" not in data:
            return jsonify({"error": "No question provided"}), 400
        
        question = data["question"]
        answer = ask_question(question)
        
        return jsonify({"answer": answer})
        
    except Exception as e:
        logger.error(f"Error in /ask endpoint: {e}")
        return jsonify({"error": "Internal server error"}), 500

@app.route("/status", methods=["GET"])
def status():
    """Get current system status"""
    status_info = {
        "system_ready": manager.rag_chain is not None,
        "current_video": manager.current_video_info
    }
    return jsonify(status_info)

@app.route("/health", methods=["GET"])
def health_check():
    return jsonify({"status": "healthy", "service": "YouTube QA Assistant"})

if __name__ == "__main__":
    logger.info("Starting YouTube QA Assistant...")
    app.run(debug=True, port=5000, host='0.0.0.0')









































