document.addEventListener('DOMContentLoaded', () => {
    // ── Configuration ───────────────────────────────────────────
    // Using absolute URL to call the Render backend from Vercel frontend
    const API_BASE_URL = "https://youtube-video-anaylze.onrender.com";
    
    // Initialize Lucide icons
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // ── DOM Elements ───────────────────────────────────────────
    const analyzeBtn = document.getElementById('analyzeBtn');
    const youtubeUrlInput = document.getElementById('youtubeUrl');
    const errorMsg = document.getElementById('errorMsg');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const videoPreview = document.getElementById('videoPreview');
    const videoIframe = document.getElementById('videoIframe');
    const videoInfo = document.getElementById('videoInfo');
    const analysisGrid = document.getElementById('analysisGrid');
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const chatMessages = document.getElementById('chatMessages');

    // Video Meta Elements
    const vidTitle = document.getElementById('vidTitle');
    const vidChannel = document.getElementById('vidChannel');
    const vidDate = document.getElementById('vidDate');
    const vidPlaylist = document.getElementById('vidPlaylist');

    let isLoading = false;
    window.currentVideoContext = null;

    // ── Helpers ────────────────────────────────────────────────
    function getYoutubeID(url) {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }

    function addMessage(text, isUser = false, isHtml = false) {
        if (!text) return;
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${isUser ? 'user' : 'bot'}`;
        
        if (isHtml) {
            msgDiv.innerHTML = text;
        } else {
            msgDiv.textContent = text;
        }
        
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
    }

    function setBtnLoading(loading) {
        isLoading = loading;
        analyzeBtn.disabled = loading;
        chatInput.disabled = loading;
        sendBtn.disabled = loading;
        
        if (loading) {
            analyzeBtn.innerHTML = '<i class="spinner-small"></i> Processing...';
        } else {
            analyzeBtn.innerHTML = '<i data-lucide="zap"></i> Analyze Video';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }

    // ── Core Event Handlers ────────────────────────────────────
    
    // 1. Analyze Video
    analyzeBtn.addEventListener('click', async () => {
        if (isLoading) return; 
        
        const url = youtubeUrlInput.value.trim();
        const videoId = getYoutubeID(url);

        if (!videoId) {
            errorMsg.innerText = "Please enter a valid YouTube link like: https://youtube.com/watch?v=...";
            errorMsg.style.display = 'block';
            youtubeUrlInput.style.borderColor = 'var(--primary)';
            return;
        }

        errorMsg.style.display = 'none';
        youtubeUrlInput.style.borderColor = 'var(--glass-border)';
        
        showLoader();
        setBtnLoading(true);

        try {
            // Using absolute API endpoint for cross-domain support
            const response = await fetch(`${API_BASE_URL}/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });

            if (!response.ok) {
                let errText = "Could not reach the AI Server.";
                try {
                    const data = await response.json();
                    errText = data.error || errText;
                } catch(e) {}
                throw new Error(errText);
            }

            const res = await response.json();
            if (!res.success) throw new Error(res.error || 'Backend reported failure.');
            
            displayResults(videoId, res.data);
        } catch (error) {
            console.error("ANALYSIS_ERROR:", error);
            addMessage(`❌ ERROR: ${error.message}`, false);
            alert("Analysis Error: " + error.message);
        } finally {
            hideLoader();
            setBtnLoading(false);
        }
    });

    function displayResults(videoId, data) {
        analysisGrid.innerHTML = '';
        videoIframe.src = `https://www.youtube.com/embed/${videoId}`;
        videoPreview.style.display = 'block';
        videoInfo.style.display = 'block';
        
        vidTitle.textContent = data.title;
        vidChannel.textContent = data.channel;
        vidDate.textContent = `Analyzed: ${new Date().toLocaleDateString()}`;
        vidPlaylist.textContent = "AI Smart Summary";

        const analysisData = [
            { icon: 'file-text', title: 'Smart Summary', content: data.summary },
            { icon: 'target', title: 'Main Concept', content: data.main_topic },
            { icon: 'compass', title: 'Video Motive', content: data.motive },
            { icon: 'book-open', title: 'Educational Value', content: data.teaching },
            { icon: 'list', title: 'Key Highlights', content: data.key_points ? data.key_points.join('\n') : "N/A" },
            { icon: 'star', title: 'Difficulty', content: data.difficulty || "Beginner" }
        ];

        analysisData.forEach(item => {
            const card = document.createElement('div');
            card.className = 'analysis-card glass';
            card.innerHTML = `
                <i data-lucide="${item.icon}" class="card-icon"></i>
                <h3 class="card-title">${item.title}</h3>
                <p class="card-content">${item.content}</p>
            `;
            analysisGrid.appendChild(card);
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();

        addMessage(`I've analyzed "${data.title}"! Ask me any specific question about it.`, false);
        window.currentVideoContext = data; 
    }

    // 2. Chat Functionality
    sendBtn.addEventListener('click', async () => {
        const text = chatInput.value.trim();
        if (!text || isLoading) return;

        addMessage(text, true);
        chatInput.value = '';
        setBtnLoading(true);

        try {
            const response = await fetch(`${API_BASE_URL}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: text })
            });

            if (!response.ok) throw new Error("Chat Server unreachable.");

            const res = await response.json();
            if (!res.success) throw new Error(res.error || 'Chat failed.');
            
            addMessage(res.data.answer, false);
        } catch (error) {
            console.error("CHAT_ERROR:", error);
            addMessage(`❌ ERROR: ${error.message}`, false);
        } finally {
            setBtnLoading(false);
        }
    });

    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendBtn.click();
    });

    // ── UI / Utilities ───────────────────────────────────────────
    window.askQuestion = (text) => {
        if (isLoading) return;
        chatInput.value = text;
        sendBtn.click();
    };

    const resizeHandle = document.getElementById('resizeHandle');
    const rightPanel = document.querySelector('.right-panel');
    const dashboardWrapper = document.querySelector('.dashboard-wrapper');
    
    // Panel Resizing Logic
    resizeHandle.addEventListener('mousedown', (e) => {
        document.body.style.cursor = 'col-resize';
        const move = (e) => {
            const newWidth = dashboardWrapper.getBoundingClientRect().right - e.clientX;
            if (newWidth >= 280 && newWidth <= 600) {
                rightPanel.style.width = `${newWidth}px`;
                rightPanel.style.flexBasis = `${newWidth}px`;
            }
        };
        const stop = () => {
            document.body.style.cursor = 'default';
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', stop);
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', stop);
    });
});

// Loaders and Global Exports
let startTime;
let interval;
function showLoader() {
    const overlay = document.getElementById("loadingOverlay");
    const text = document.getElementById("loadingText");
    overlay.style.display = "flex";
    startTime = Date.now();
    interval = setInterval(() => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        text.innerText = `Analyzing video content... (${elapsed}s)`;
    }, 100);
}

function hideLoader() {
    const overlay = document.getElementById("loadingOverlay");
    clearInterval(interval);
    overlay.style.display = "none";
}

window.copySummary = () => {
    if (!window.currentVideoContext) return;
    const data = window.currentVideoContext;
    const text = `Summary: ${data.summary}\n\nKey Points: ${data.key_points.join(', ')}`;
    navigator.clipboard.writeText(text).then(() => alert("Copied!"));
};

window.downloadSummary = () => {
    if (!window.currentVideoContext) return;
    const data = window.currentVideoContext;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = "video_analysis.txt";
    a.click();
};
