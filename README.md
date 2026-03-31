# 🎥 YouTube Video Analyzer AI

A real-time AI system to extract structured insights from YouTube videos and chat with them using **Grok (xAI)**.

---

## 🚀 Setup Instructions

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

---

### 2. Configure API Key

* Create a `.env` file in the root directory
* Add your **Grok API Key**

```env
GROk_API_KEY=your_api_key_here
```

---

### 3. Run the Backend

```bash
python main.py
```

Backend will start at:
👉 `http://localhost:8000`

---

### 4. Run the Frontend

* Open `index.html` in your browser
* OR use Live Server (recommended)

---

## ⚡ Features

* 🎯 **Video Analysis**

  * Structured summary
  * Key insights
  * Important concepts
  * Difficulty level

* 💬 **AI Chat**

  * Ask questions about video
  * Context-aware responses

* ⚙️ **FastAPI Backend**

  * Async & high-performance
  * Scalable architecture

* 🧠 **Grok (xAI) Integration**

  * Fast and intelligent responses
  * Automatic retry & fallback handling

---

## 🧠 AI System Behavior

* 🔁 Auto-retry on failures
* 🔄 Model fallback (grok-1.5 → grok-1 → grok-mini)
* 🛡️ Handles API errors (401, 402, 429) internally
* ⚡ Always returns a response (no crashes)

---

## 📡 API Documentation

Once backend is running:

* 📘 Swagger UI
  👉 http://localhost:8000/docs

* 📕 ReDoc
  👉 http://localhost:8000/redoc

---

## 🛠 Tech Stack

* **Backend**: FastAPI
* **Frontend**: HTML, CSS, JavaScript
* **AI Model**: Grok (xAI)
* **Architecture**: RAG-based system

---

## 💡 Notes

* Ensure your API key has active access
* If API fails, system will auto-retry and fallback
* Frontend loader shows real-time processing status

---

## 🎯 Future Improvements

* 🔊 Voice interaction
* 📊 Visual insights (charts/graphs)
* 🧠 Long-term memory (multi-video chat)
* ⚡ Streaming responses

---

## 🧑‍💻 Author

Built with ❤️ for learning and experimentation in AI systems.
