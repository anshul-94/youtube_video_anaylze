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
    analyzeBtn.addEventListener('click', () => {
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

        // Simulate API Delay
        setTimeout(() => {
            loadingOverlay.style.display = 'none';
            displayResults(videoId);
        }, 2000);
    });

    function displayResults(videoId) {
        // Clear previous results (including empty state)
        analysisGrid.innerHTML = '';

        // 1. Update Left Panel (Video)
        videoIframe.src = `https://www.youtube.com/embed/${videoId}`;
        videoPreview.style.display = 'block';
        videoInfo.style.display = 'block';
        
        // Mock Video Meta
        vidTitle.textContent = "Mastering Glassmorphism: The Ultimate Guide to Modern UI";
        vidChannel.textContent = "Design Academy Pro";
        vidDate.textContent = "Published: Mar 15, 2026";
        vidPlaylist.textContent = "Creative Coding Series";

        // 2. Update Center Panel (Analysis)
        const analysisData = [
            {
                icon: 'file-text',
                title: 'Short Summary',
                content: 'An in-depth exploration of glassmorphism design, focusing on CSS-only techniques for creating layered, blurred, and transparent UI components that feel premium and modern.'
            },
            {
                icon: 'target',
                title: 'Main Topic',
                content: 'Glassmorphism Design & CSS Implementation'
            },
            {
                icon: 'compass',
                title: 'Video Motive / Purpose',
                content: 'To bridge the gap between static design concepts and functional web implementations using modern browser features.'
            },
            {
                icon: 'book-open',
                title: 'What the creator is teaching',
                content: 'Effective use of backdrop-filter, managing color contrast on transparent backgrounds, and layering box-shadows for depth.'
            },
            {
                icon: 'list',
                title: 'Key Concepts / Key Points',
                content: '• Backdrop-filter blur\n• Semi-transparent borders\n• Z-index layering\n• Accessibility in Glassmorphism'
            },
            {
                icon: 'users',
                title: 'Who should watch this video',
                content: 'Front-end developers and UI/UX designers looking to elevate their visual design skills and technical implementation.'
            },
            {
                icon: 'bar-chart',
                title: 'Estimated Difficulty Level',
                content: '<span class="difficulty-badge">Intermediate</span>'
            },
            {
                icon: 'clock',
                title: 'Important Timestamps',
                content: '• 02:45 Intro to Blur\n• 05:20 Border Layering\n• 08:15 Contrast Fixes\n• 12:40 Final Example'
            }
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

        // REFRESH LUCIDE ICONS
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }

        // 3. Update Chat Panel
        addMessage("I've finished analyzing the video! You can ask me to summarize specific parts, create a quiz, or explain the main concepts.", false);
    }

    // Chat Functionality
    let isLoading = false;

    function addMessage(text, isUser = false, isHtml = false) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${isUser ? 'user' : 'bot'}`;
        
        if (isHtml) {
            msgDiv.innerHTML = text;
        } else {
            msgDiv.textContent = text;
        }
        
        chatMessages.appendChild(msgDiv);
        
        // Smooth scroll to bottom
        chatMessages.scrollTo({
            top: chatMessages.scrollHeight,
            behavior: 'smooth'
        });
    }

    function setLoading(loading) {
        isLoading = loading;
        chatInput.disabled = loading;
        sendBtn.disabled = loading;
        
        if (loading) {
            // Add typing indicator
            const typingDiv = document.createElement('div');
            typingDiv.className = 'typing-indicator';
            typingDiv.id = 'typingIndicator';
            typingDiv.innerHTML = '<span></span><span></span><span></span>';
            chatMessages.appendChild(typingDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        } else {
            // Remove typing indicator
            const indicator = document.getElementById('typingIndicator');
            if (indicator) indicator.remove();
        }
    }

    // Initial greeting
    addMessage("Hello! I'm your AI Video Assistant. Paste a YouTube video link and I will analyze it for you. You can ask me for summaries, key points, or explanations from the video.", false);

    sendBtn.addEventListener('click', async () => {
        const text = chatInput.value.trim();
        if (!text || isLoading) return;

        addMessage(text, true);
        chatInput.value = '';
        
        setLoading(true);

        try {
            // Simulate API Delay with Promise
            const response = await new Promise((resolve, reject) => {
                setTimeout(() => {
                    // Simulate occasional error for testing (comment out for production)
                    // if (Math.random() > 0.9) reject(new Error("Simulated failure"));
                    
                    const aiResponse = generateAIResponse(text);
                    resolve(aiResponse);
                }, 1500);
            });

            setLoading(false);
            addMessage(response, false);
        } catch (error) {
            console.error("Chat Error:", error);
            setLoading(false);
            addMessage("Something went wrong. Please try again.", false);
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

// Global Utilities
window.copySummary = () => {
    const summary = "Mastering Glassmorphism Summary: This video covers CSS-only techniques for creating premium transparent UI components. Key points include backdrop-filter, contrast management, and layering.";
    navigator.clipboard.writeText(summary).then(() => {
        alert("Summary copied to clipboard!");
    });
};

window.downloadSummary = () => {
    const notes = "AI VIDEO ANALYSIS NOTES\n\nVideo: Mastering Glassmorphism\n\nSummary: Exploration of glassmorphism design...\nKey Concepts:\n- Backdrop-filter blur\n- Semi-transparent borders\n- Z-index layering\n\nDifficulty: Intermediate";
    const blob = new Blob([notes], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'video-analysis-notes.txt';
    a.click();
};
