document.addEventListener('DOMContentLoaded', () => {
    // Initialize Lucide icons
    lucide.createIcons();

    // DOM Elements
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

    // Utility: Extract YouTube Video ID
    function getYoutubeID(url) {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }

    // Handle Analysis
    analyzeBtn.addEventListener('click', async () => {
        if (isLoading) return; // Prevent multiple clicks
        
        const url = youtubeUrlInput.value.trim();
        const videoId = getYoutubeID(url);

        if (!videoId) {
            errorMsg.style.display = 'block';
            youtubeUrlInput.style.borderColor = 'var(--primary)';
            return;
        }

        errorMsg.style.display = 'none';
        youtubeUrlInput.style.borderColor = 'var(--glass-border)';
        
        // Show Loading
        showLoader();
        setLoading(true);

        try {
            const minTime = new Promise(res => setTimeout(res, 1500));
            const apiCall = fetch('/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });

            const [_, response] = await Promise.all([minTime, apiCall]);

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Analysis failed');
            }

            const res = await response.json();
            if (!res.success) throw new Error(res.error || 'Analysis failed');
            displayResults(videoId, res.data);
        } catch (error) {
            console.error("Analysis Error:", error);
            addMessage("Error: " + error.message, false);
            alert("Error analyzing video: " + error.message);
        } finally {
            hideLoader();
            setLoading(false);
        }
    });

    function displayResults(videoId, data) {
        // Clear previous results
        analysisGrid.innerHTML = '';

        // 1. Update Left Panel (Video)
        videoIframe.src = `https://www.youtube.com/embed/${videoId}`;
        videoPreview.style.display = 'block';
        videoInfo.style.display = 'block';
        
        vidTitle.textContent = data.title;
        vidChannel.textContent = data.channel;
        vidDate.textContent = `Published: ${new Date().toLocaleDateString()}`;
        vidPlaylist.textContent = "AI Analysis";

        // 2. Update Center Panel (Analysis)
        const analysisData = [
            { icon: 'file-text', title: 'Short Summary', content: data.summary },
            { icon: 'target', title: 'Main Topic', content: data.main_topic },
            { icon: 'compass', title: 'Video Motive / Purpose', content: data.motive },
            { icon: 'book-open', title: 'What the creator is teaching', content: data.teaching },
            { icon: 'list', title: 'Key Points', content: data.key_points.join('\n') },
            { icon: 'users', title: 'What you will learn', content: data.learning }
        ];

        analysisData.forEach(item => {
            const card = document.createElement('div');
            card.className = 'analysis-card glass';
            card.innerHTML = `
                <i data-lucide="${item.icon}" class="card-icon"></i>
                <h3 class="card-title">${item.title}</h3>
                <p class="card-content">${item.content}</p>
            `;
            if (item.isHtml) {
                card.querySelector('.card-content').innerHTML = item.content;
            }
            analysisGrid.appendChild(card);
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();

        // 3. Update Chat Panel
        addMessage(`I've finished analyzing "${data.title}"! You can ask me anything about it.`, false);
        window.currentVideoContext = data; 
    }

    // Chat Functionality
    let isLoading = false;

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

    function setLoading(loading) {
        isLoading = loading;
        chatInput.disabled = loading;
        sendBtn.disabled = loading;
        
        if (loading) {
            const typingDiv = document.createElement('div');
            typingDiv.className = 'typing-indicator';
            typingDiv.id = 'typingIndicator';
            typingDiv.innerHTML = '<span></span><span></span><span></span>';
            chatMessages.appendChild(typingDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        } else {
            const indicator = document.getElementById('typingIndicator');
            if (indicator) indicator.remove();
        }
    }

    sendBtn.addEventListener('click', async () => {
        const text = chatInput.value.trim();
        if (!text || isLoading) return;

        addMessage(text, true);
        chatInput.value = '';
        
        setLoading(true);

        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: text })
            });

            if (!response.ok) {
                let errDetail = 'Chat failed';
                try {
                    const errData = await response.json();
                    errDetail = errData.error || errDetail;
                } catch(e) {}
                throw new Error(errDetail);
            }

            const res = await response.json();
            if (!res.success) throw new Error(res.error || 'Chat failed');
            setLoading(false);
            addMessage(res.data.answer, false);
        } catch (error) {
            console.error("Chat Error:", error);
            setLoading(false);
            addMessage(`❌ Error: ${error.message}`, false);
        }
    });

    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !isLoading) sendBtn.click();
    });


    // Global helper for chips
    window.askQuestion = (text) => {
        if (isLoading) return;
        chatInput.value = text;
        sendBtn.click();
    };

    // PANEL RESIZING LOGIC
    const resizeHandle = document.getElementById('resizeHandle');
    const rightPanel = document.querySelector('.right-panel');
    const dashboardWrapper = document.querySelector('.dashboard-wrapper');
    
    // Load last width from localStorage
    const savedWidth = localStorage.getItem('chatPanelWidth');
    if (savedWidth) {
        const width = Math.min(Math.max(parseInt(savedWidth), 280), 600);
        rightPanel.style.flexBasis = `${width}px`;
        rightPanel.style.width = `${width}px`;
    }

    let isResizing = false;

    // Start Resizing
    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.style.cursor = 'col-resize';
        resizeHandle.classList.add('active');
        
        // Disable transitions during drag for immediate feedback
        rightPanel.style.transition = 'none';
        
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', stopResizing);
        e.preventDefault(); // Stop text selection
    });

    function handleMouseMove(e) {
        if (!isResizing) return;
        
        // Calculate width: from right edge to cursor
        const containerRect = dashboardWrapper.getBoundingClientRect();
        const newWidth = containerRect.right - e.clientX;
        
        // Apply Constraints (280px - 600px)
        if (newWidth >= 280 && newWidth <= 600) {
            rightPanel.style.flexBasis = `${newWidth}px`;
            rightPanel.style.width = `${newWidth}px`;
        }
    }

    function stopResizing() {
        if (!isResizing) return;
        
        isResizing = false;
        document.body.style.cursor = 'default';
        resizeHandle.classList.remove('active');
        
        // Re-enable transitions
        rightPanel.style.transition = 'flex-basis 0.2s ease, width 0.2s ease';
        
        // Save current width to local storage
        const currentWidth = rightPanel.offsetWidth;
        localStorage.setItem('chatPanelWidth', currentWidth);
        
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', stopResizing);
    }
});

// Global Utilities (Fixed to use real data)
window.copySummary = () => {
    if (!window.currentVideoContext) {
        alert("Please analyze a video first.");
        return;
    }
    const data = window.currentVideoContext;
    const summaryText = `${data.title} Summary:\n${data.summary}\n\nKey Points:\n${data.key_points.join('\n')}`;
    navigator.clipboard.writeText(summaryText).then(() => {
        alert("Summary and Key Points copied to clipboard!");
    });
};

window.downloadSummary = () => {
    if (!window.currentVideoContext) {
        alert("Please analyze a video first.");
        return;
    }
    const data = window.currentVideoContext;
    const notes = `AI VIDEO ANALYSIS NOTES\n\nTitle: ${data.title}\nChannel: ${data.channel}\n\nSummary:\n${data.summary}\n\nMain Topic: ${data.main_topic}\n\nKey Points:\n${data.key_points.join('\n- ')}\n\nLearning Outcome: ${data.learning}\nDifficulty: ${data.difficulty}`;
    const blob = new Blob([notes], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_notes.txt`;
    a.click();
};


let startTime;
let interval;
let failsafeTimeout;

function showLoader() {
  const overlay = document.getElementById("loadingOverlay");
  const text = document.getElementById("loadingText");

  clearInterval(interval);
  clearTimeout(failsafeTimeout);

  overlay.style.display = "flex";
  overlay.style.opacity = "1";

  startTime = Date.now();
  text.innerText = `Analyzing video content... (0.0s)`;

  interval = setInterval(() => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    text.innerText = `Analyzing video content... (${elapsed}s)`;
  }, 100);

  // FAILSAFE
  failsafeTimeout = setTimeout(() => {
    clearInterval(interval);
    text.innerText = "Taking longer than expected...";
    setTimeout(() => {
      hideLoader();
    }, 2000); // Wait 2s before force hiding
  }, 10000);
}

function hideLoader() {
  const overlay = document.getElementById("loadingOverlay");
  const text = document.getElementById("loadingText");

  clearInterval(interval);
  clearTimeout(failsafeTimeout);

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  if (text.innerText !== "Taking longer than expected...") {
    text.innerText = `Responded in ${totalTime}s`;
  }

  // Smooth fade out
  setTimeout(() => {
    overlay.style.opacity = "0";
    overlay.style.transition = "opacity 0.3s ease";

    setTimeout(() => {
      overlay.style.display = "none";
      overlay.style.opacity = "1";
    }, 300);
  }, 500);
}

