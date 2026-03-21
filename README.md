# YouTube Video Analyzer AI

A real-time AI system to extract structured insights from YouTube videos and chat with them using Gemini 1.5 Flash.

## Setup Instructions

1. **Install Dependencies**
   ```bash
   pip install -r requirements.txt
   ```

2. **Configure API Key**
   - Copy `.env.example` to `.env`
   - Add your [Gemini API Key](https://aistudio.google.com/app/apikey) to the `.env` file.

3. **Run the Backend**
   ```bash
   python main.py
   ```
   The backend will run at `http://localhost:8000`.

4. **Run the Frontend**
   - Open `index.html` in your browser. (You can use a Live Server or just open the file directly if CORS allows, but a local server is recommended).

## Features
- **Video Analysis**: Get a structured summary, key points, difficulty level, and more.
- **AI Chat**: Ask questions directly about the video content.
- **FastAPI Backend**: High-performance async API.
- **Gemini 1.5 Flash**: Fast and intelligent processing.

## API Documentation
Once the backend is running, visit:
- [Interactive Docs (Swagger)](http://localhost:8000/docs)
- [Alternative Docs (Redoc)](http://localhost:8000/redoc)
