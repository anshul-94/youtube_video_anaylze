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
        loadingOverlay.style.display = 'flex';
        setLoading(true);

        try {
            const response = await fetch('http://localhost:8000/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });

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
            loadingOverlay.style.display = 'none';
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
            { icon: 'users', title: 'What you will learn', content: data.learning },
            { icon: 'bar-chart', title: 'Difficulty Level', content: `<span class="difficulty-badge">${data.difficulty}</span>`, isHtml: true }
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
            const response = await fetch('http://localhost:8000/chat', {
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

    // Mock AI Logic
    function generateAIResponse(query) {
        query = query.toLowerCase();
        if (query.includes('summarize')) return "In short, the video teaches how to use CSS 'backdrop-filter: blur' with semi-transparent borders to create a glass-like effect while maintaining readability.";
        if (query.includes('concept')) return "The main concept is the 'layering' system where you use multiple thin borders and subtle shadows to simulate depth without heavy colors.";
        if (query.includes('notes')) return "Notes generated: 1. Always use high-contrast text. 2. Border should be 1px solid rgba(255,255,255,0.1). 3. Blur radius should be between 8-16px.";
        if (query.includes('quiz')) return "Here's a quick question: Which CSS property is essential for the frosted glass effect? (Answer: backdrop-filter)";
        return "That's a great question! Based on the video content, this relates to the 'Visual Hierarchy' section mentioned around the 8-minute mark.";
    }

    // Global helper for chips
    window.askQuestion = (text) => {
        if (isLoading) return;
        chatInput.value = text;
        sendBtn.click();
    };
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
