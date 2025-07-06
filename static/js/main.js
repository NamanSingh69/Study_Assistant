document.addEventListener('DOMContentLoaded', () => {
    // --- State Variables ---
    let appState = {
        currentView: 'input-view',
        isLoading: false,
        loadingMessage: '',
        contentId: null, // Temporary ID for the current processing session
        notes: '',
        originalText: '',
        title: '',
        webSearchEnabled: true,
        quizzes: [], // Array of quiz objects { quiz_id, questions: [] }
        flashcards: [], // Array of flashcard objects { flashcard_id, cards: [] }
        mindMapSyntax: '',
        chatHistory: [], // Array of { role: 'user'/'model', parts: [text] }
        selectedFiles: new Map(),
        currentFlashcardSetIndex: 0, // Index of the quiz object in quizzes array
        currentFlashcardIndex: 0, // Index within the current flashcard set
        quizAnswers: {}, // Stores user answers for the current quiz { q_index: answer }
        quizResults: {}, // Stores results after submission { q_index: { correct: bool, feedback_html: str } }
        preferences: {
            sidebarCollapsed: false,
            darkMode: true,
            fontSize: 'normal', // 'small', 'normal', 'large'
            lastUsedDownloadFormat: 'md'
        },
        animations: true, // Global toggle for animations
        librariesLoaded: {
            mermaid: false,
            jsPlumb: false,
            cytoscape: false
        }
    };

    // Load user preferences from localStorage if available
    try {
        const savedPreferences = localStorage.getItem('studyAssistantPreferences');
        if (savedPreferences) {
            appState.preferences = {...appState.preferences, ...JSON.parse(savedPreferences)};
            console.log("Loaded saved preferences:", appState.preferences);
        }
    } catch (e) {
        console.warn("Couldn't load saved preferences:", e);
    }

    // --- DOM Elements ---
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('main-content');
    const sidebarLinks = document.querySelectorAll('.sidebar-link');
    const views = document.querySelectorAll('.view');
    const loadingIndicator = document.getElementById('loading-indicator');
    const toggleSidebarBtn = document.getElementById('toggle-sidebar'); // Mobile toggle
    const sidebarOverlay = document.getElementById('sidebar-overlay'); // Mobile overlay
    const collapseSidebarDesktopBtn = document.getElementById('collapse-sidebar-desktop'); // Desktop collapse
    const collapseIcon = document.getElementById('collapse-icon');
    const expandIcon = document.getElementById('expand-icon');
    const collapseText = document.getElementById('collapse-text');

    // Input View Elements
    const inputView = document.getElementById('input-view');
    const urlsInput = document.getElementById('urls-input');
    const topicInput = document.getElementById('topic-input');
    const descriptionInput = document.getElementById('description-input');
    const dragDropArea = document.getElementById('drag-drop-area');
    const filesInput = document.getElementById('files-input');
    const fileInputLabel = document.getElementById('file-input-label');
    const selectedFilesDiv = document.getElementById('selected-files');
    const webSearchToggle = document.getElementById('web-search-toggle');
    const generateQuizToggle = document.getElementById('generate-quiz-toggle');
    const generateFlashcardsToggle = document.getElementById('generate-flashcards-toggle');
    const generateMindmapToggle = document.getElementById('generate-mindmap-toggle');
    const processContentBtn = document.getElementById('process-content-btn');
    const processingWarningsDiv = document.getElementById('processing-warnings');
    const processingErrorsDiv = document.getElementById('processing-errors');

    // Notes View Elements
    const notesView = document.getElementById('notes-view');
    const notesTitle = document.getElementById('notes-title');
    const notesContent = document.getElementById('notes-content');
    const downloadFormatSelect = document.getElementById('download-format');
    const downloadNotesBtn = document.getElementById('download-notes-btn');
    const toggleOriginalContentBtn = document.getElementById('toggle-original-content');
    const originalContentContainer = document.getElementById('original-content-container');
    const originalContentPre = originalContentContainer.querySelector('pre');

    // Quiz View Elements
    const quizView = document.getElementById('quiz-view');
    const generateMoreQuestionsBtn = document.getElementById('generate-more-questions-btn');
    const quizOptionsDiv = document.getElementById('quiz-options');
    const numQuestionsInput = document.getElementById('num-questions-input');
    const quizContent = document.getElementById('quiz-content');
    const quizActions = document.getElementById('quiz-actions');
    const submitQuizBtn = document.getElementById('submit-quiz-btn');
    const quizResultsSummary = document.getElementById('quiz-results-summary');
    const applyQuizOptionsBtn = document.getElementById('apply-quiz-options');

    // Flashcards View Elements
    const flashcardsView = document.getElementById('flashcards-view');
    const generateMoreFlashcardsBtn = document.getElementById('generate-more-flashcards-btn');
    const flashcardsDisplayArea = document.getElementById('flashcards-display-area');
    const noFlashcardsMessage = document.getElementById('no-flashcards-message');
    let flashcardContainer = document.getElementById('flashcard');
    let flashcardFront = document.getElementById('flashcard-front');
    let flashcardBack = document.getElementById('flashcard-back');
    let prevCardBtn = document.getElementById('prev-card-btn');
    let flipCardBtn = document.getElementById('flip-card-btn');
    let nextCardBtn = document.getElementById('next-card-btn');
    let cardCounter = document.getElementById('card-counter');

    // Mind Map View Elements
    const mindmapView = document.getElementById('mindmap-view');
    const generateMindmapBtn = document.getElementById('generate-mindmap-btn');
    const mindmapCard = document.getElementById('mindmap-card'); // Reference the card
    const mindmapContainer = document.getElementById('mindmap-container');
    const mindmapErrorDiv = document.getElementById('mindmap-error');
    const mindmapFullscreenBtn = document.getElementById('mindmap-fullscreen-btn'); // New
    const mindmapExitFullscreenBtn = document.getElementById('mindmap-exit-fullscreen-btn'); // New

    // Chat View Elements
    const chatView = document.getElementById('chat-view');
    const chatHistoryDiv = document.getElementById('chat-history');
    const chatInput = document.getElementById('chat-input');
    const sendMessageBtn = document.getElementById('send-message-btn');

    // --- Dynamic Library Loading ---
    function loadLibrary(libraryName, url, callback) {
        if (appState.librariesLoaded[libraryName]) {
            if (callback) callback();
            return;
        }

        const script = document.createElement('script');
        script.src = url;
        // Remove integrity and crossorigin attributes
        script.onload = () => {
            console.log(`${libraryName} library loaded successfully`);
            appState.librariesLoaded[libraryName] = true;
            if (callback) callback();
        };
        script.onerror = (error) => {
            console.error(`Error loading ${libraryName} library:`, error);
            if (callback) callback(error);
        };
        document.head.appendChild(script);
    }

    // Function to load all required libraries for mindmap
    function loadMindMapLibraries(callback) {
        // Use a newer version of Mermaid
        loadLibrary('mermaid', 'https://cdn.jsdelivr.net/npm/mermaid@10.6.1/dist/mermaid.min.js', (error) => {
            if (!error && window.mermaid) {
                try {
                    // Initialize Mermaid using mermaid.initialize()
                    window.mermaid.initialize({
                        startOnLoad: false, // Important: We'll render manually
                        theme: 'dark',
                        securityLevel: 'loose', // Or 'strict' or 'antiscript' depending on needs
                        logLevel: 'info', // Set log level for debugging (info, warn, error, fatal)
                        flowchart: {
                            useMaxWidth: true,
                            htmlLabels: true, // Enable HTML labels if needed
                            curve: 'basis' // Or 'linear', 'step', etc.
                        },
                        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
                        themeVariables: { // Example theme variables for dark mode
                            primaryColor: '#2563eb', // A slightly darker blue
                            primaryTextColor: '#ffffff',
                            primaryBorderColor: '#3b82f6',
                            lineColor: '#4b5563', // Gray lines
                            secondaryColor: '#374151', // Darker gray nodes
                            tertiaryColor: '#1f2937', // Background color
                            fontSize: '16px' // *** INCREASED FONT SIZE (default is 16px, try larger if needed) ***
                        }
                    });
                    console.log("Mermaid initialized successfully");
                } catch (e) {
                    console.error("Error initializing mermaid:", e);
                    // Mark as not loaded if init fails
                    appState.librariesLoaded.mermaid = false;
                }
            } else {
                 appState.librariesLoaded.mermaid = false; // Ensure it's marked false if load fails
            }

            // Load jsPlumb without integrity check
            loadLibrary('jsPlumb', 'https://cdnjs.cloudflare.com/ajax/libs/jsPlumb/2.15.6/js/jsplumb.min.js', (error) => {
                if (error) {
                    console.warn("jsPlumb failed to load, will fall back to alternative visualization");
                }

                // Load Cytoscape without integrity check
                loadLibrary('cytoscape', 'https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.25.0/cytoscape.min.js', (error) => {
                    if (error) {
                        console.warn("Cytoscape failed to load, will fall back to simplest visualization");
                    }
                    if (callback) callback(); // Call callback regardless of jsPlumb/Cytoscape success
                });
            });
        });
    }

    // --- Mindmap Fullscreen Logic ---
    function enterMindmapFullscreen() {
        if (!mindmapCard) return;
        console.log("Entering Mindmap Fullscreen");
        document.body.classList.add('mindmap-fullscreen-active');
        mindmapFullscreenBtn.classList.add('hidden'); // Hide enter button
        mindmapExitFullscreenBtn.classList.remove('hidden'); // Show exit button

        // Optional: Re-render or fit the diagram after a short delay
        // to allow CSS transitions to complete and container to resize.
        setTimeout(() => {
             const cytoscapeInstance = window.cytoscape && mindmapContainer.querySelector('#cytoscape-canvas') ? window.cytoscape.instance(mindmapContainer.querySelector('#cytoscape-canvas')) : null;
             if (cytoscapeInstance) {
                 cytoscapeInstance.resize();
                 cytoscapeInstance.fit(null, 30); // Refit with padding
             } else if (mindmapContainer.querySelector('.mermaid svg')) {
                 // For Mermaid, resizing is often handled by CSS, but might need trigger if complex
                 // No standard API call to force reflow easily. The SVG should adapt.
             }
             console.log("Resized/refit mindmap for fullscreen.");
        }, 350); // Delay matches CSS transition duration roughly
    }

    function exitMindmapFullscreen() {
        console.log("Exiting Mindmap Fullscreen");
        document.body.classList.remove('mindmap-fullscreen-active');
        mindmapFullscreenBtn.classList.remove('hidden'); // Show enter button
        mindmapExitFullscreenBtn.classList.add('hidden'); // Hide exit button

        // Optional: Re-render or fit diagram again after exiting
        setTimeout(() => {
             const cytoscapeInstance = window.cytoscape && mindmapContainer.querySelector('#cytoscape-canvas') ? window.cytoscape.instance(mindmapContainer.querySelector('#cytoscape-canvas')) : null;
             if (cytoscapeInstance) {
                 cytoscapeInstance.resize();
                 cytoscapeInstance.fit(null, 30);
             }
             console.log("Resized/refit mindmap after exiting fullscreen.");
        }, 350);
    }

    // --- Initialization ---
    // Apply saved preferences
    function applyUserPreferences() {
        try {
            // Apply sidebar state - with safety checks
            if (sidebar && appState.preferences.sidebarCollapsed) {
                sidebar.classList.add('collapsed-desktop');
                sidebar.style.width = '68px';
                if (mainContent) mainContent.style.marginLeft = '68px';

                if (collapseIcon) collapseIcon.classList.add('hidden');
                if (expandIcon) expandIcon.classList.remove('hidden');
                if (collapseText) collapseText.textContent = '';
            }

            // Apply download format - with safety check
            if (downloadFormatSelect && appState.preferences.lastUsedDownloadFormat) {
                downloadFormatSelect.value = appState.preferences.lastUsedDownloadFormat;
            }

            // Set font size
            const root = document.documentElement;
            if (root) {
                switch (appState.preferences.fontSize) {
                    case 'small':
                        root.style.setProperty('--base-font-size', '0.9rem');
                        break;
                    case 'large':
                        root.style.setProperty('--base-font-size', '1.1rem');
                        break;
                    default:
                        root.style.setProperty('--base-font-size', '1rem');
                }
            }
        } catch (error) {
            console.error("Error applying user preferences:", error);
        }
    }

    // Save preferences to localStorage
    function savePreferences() {
        try {
            localStorage.setItem('studyAssistantPreferences', JSON.stringify(appState.preferences));
        } catch (e) {
            console.warn("Couldn't save preferences:", e);
        }
    }

    // Apply initial preferences, update button state and set up event listeners
    applyUserPreferences();
    updateProcessButtonState();
    setupEventListeners();

    // Hide generation options initially
    quizOptionsDiv.classList.add('hidden');

    // --- Helper Functions ---
    function setLoading(isLoading, message = 'Processing...') {
        appState.isLoading = isLoading;
        appState.loadingMessage = message;

        // Target new elements
        const indicatorContainer = document.getElementById('loading-indicator'); // The overall toggle container
        const progressBarContainer = document.getElementById('loading-progress-bar-container');
        const textCorner = document.getElementById('loading-text-corner');

        if (!indicatorContainer || !progressBarContainer || !textCorner) {
             console.error("Loading indicator elements not found!");
             return;
        }

        if (isLoading) {
            textCorner.textContent = message;
            // Ensure the main container is visible first
            indicatorContainer.classList.remove('hidden');
            // Then show the specific elements (allows for potential fade-in later)
            progressBarContainer.style.display = 'block';
            textCorner.style.display = 'block';
            // Force repaint/reflow might be needed for smooth animation start in some browsers
             void progressBarContainer.offsetWidth;
        } else {
            // Hide the specific elements first
            progressBarContainer.style.display = 'none';
            textCorner.style.display = 'none';
            // Then hide the main container
             indicatorContainer.classList.add('hidden');
        }
    }

    function switchView(viewId) {
        console.log("Switching view to:", viewId);
        appState.currentView = viewId;
        views.forEach(view => {
            if (view.id === viewId) {
                view.classList.remove('hidden');
                view.classList.add('active-view');
            } else {
                view.classList.add('hidden');
                view.classList.remove('active-view');
            }
        });

        sidebarLinks.forEach(link => {
            if (link.getAttribute('data-view') === viewId) {
                link.classList.add('active-link');
            } else {
                link.classList.remove('active-link');
            }
        });

        // Close mobile sidebar and overlay on navigation
        if (window.innerWidth < 768) {
            sidebar.classList.add('collapsed-mobile');
            sidebarOverlay.classList.add('hidden');
            document.body.style.overflow = 'auto'; // Re-enable scrolling
        }

        // Special handling for mindmap view: Prepare container and trigger render logic
        if (viewId === 'mindmap-view') {
            if (!mindmapContainer) {
                console.error("Mindmap container not found when switching to mindmap view");
                return;
            }

            // Always show a basic placeholder/loading state first
            mindmapContainer.innerHTML = `
                <div class="text-center p-6">
                    <div class="loading-spinner mb-4 mx-auto"></div>
                    <p class="text-gray-400">Loading Mind Map view...</p>
                </div>
            `;

            // Safely hide and clear the error div
            if (mindmapErrorDiv) {
                mindmapErrorDiv.classList.add('hidden');
                // Clear the *entire* content of the error div directly
                mindmapErrorDiv.innerHTML = '';
            } else {
                console.warn("mindmapErrorDiv not found during view switch.");
            }

            // Use setTimeout to ensure the view switch/DOM update completes
            // before triggering the render check.
            setTimeout(() => {
                ensureMindmapRendered();
            }, 100); // Small delay
        }
    }

    function ensureMindmapRendered() {
        // Ensure container exists before proceeding
        if (!mindmapContainer || !document.body.contains(mindmapContainer)) {
            console.warn("Attempted to render mind map, but container is missing.");
            return;
        }
    
        // If no syntax exists, show the "Generate" placeholder
        if (!appState.mindMapSyntax) {
            console.log("No mind map syntax found, showing generation placeholder.");
            mindmapContainer.innerHTML = `
                <div class="text-center">
                    <span class="material-icons-round text-gray-500 text-5xl mb-4">account_tree</span>
                    <p class="text-gray-500 italic">No mind map data available. Click "Generate Mind Map" above to create one.</p>
                </div>
            `;
            return;
        }
    
        // Show loading state specifically for rendering
        mindmapContainer.innerHTML = `
            <div class="text-center p-6">
                <div class="loading-spinner mb-4 mx-auto"></div>
                <p class="text-gray-400">Preparing mind map visualization...</p>
            </div>
        `;
    
        // Load libraries if needed, and ALWAYS use the callback to render
        // This ensures libraries are loaded *before* render attempt.
        loadMindMapLibraries(() => {
            // Check container again inside the callback
            if (mindmapContainer && document.body.contains(mindmapContainer)) {
                console.log("Libraries confirmed loaded, calling renderMindmapWithAvailableLibrary.");
                renderMindmapWithAvailableLibrary(); // This function handles syntax check again internally
            } else {
                console.warn("Mindmap container became invalid before rendering could start.");
            }
        });
    }

    // Function to enable/disable feature links
    function setFeatureAvailability(available) {
        sidebarLinks.forEach(link => {
            const view = link.getAttribute('data-view');
            if (view !== 'input-view') { // Keep input always available
                link.disabled = !available;
                if (available) {
                    link.classList.remove('disabled-link');
                } else {
                    link.classList.add('disabled-link');
                    link.classList.remove('active-link'); // Deactivate if disabled
                }
            }
        });

        // Reset to input view if features become unavailable and current view is a feature view
        if (!available && appState.currentView !== 'input-view') {
            switchView('input-view');
        }
    }

    // Reset state when new content is processed
    function resetAppStateForNewContent() {
        console.log("Resetting app state for new content");
        appState.contentId = null;
        appState.notes = '';
        appState.originalText = '';
        appState.title = '';
        appState.quizzes = [];
        appState.flashcards = [];
        appState.mindMapSyntax = '';
        appState.chatHistory = [];
        appState.currentFlashcardSetIndex = 0;
        appState.currentFlashcardIndex = 0;
        appState.quizAnswers = {};
        appState.quizResults = {};

        // Clear UI elements
        notesContent.innerHTML = '<p class="text-gray-500 italic">Notes will appear here once generated.</p>';
        notesTitle.textContent = 'Study Notes';
        quizContent.innerHTML = '<p class="text-gray-500 italic text-center py-10">Quiz questions will appear here once generated.</p>';
        quizActions.classList.add('hidden');
        quizResultsSummary.textContent = '';
        flashcardsDisplayArea.classList.add('hidden');
        noFlashcardsMessage.classList.remove('hidden');
        cardCounter.textContent = '';

        // Reset mindmap with proper placeholder
        mindmapContainer.innerHTML = `
            <div class="text-center">
                <span class="material-icons-round text-gray-500 text-5xl mb-4">account_tree</span>
                <p id="mindmap-placeholder" class="text-gray-500 italic">Mind map will appear here once generated.</p>
            </div>
        `;

        mindmapErrorDiv.classList.add('hidden');
        mindmapErrorDiv.innerHTML = '';

        // Reset chat
        chatHistoryDiv.innerHTML = `
            <div class="text-center py-16">
                <span class="material-icons-round text-gray-500 text-5xl mb-4">chat</span>
                <p class="text-gray-500 italic">Chat history will appear here.</p>
            </div>
        `;

        // Reset original content
        originalContentContainer.classList.add('hidden');
        originalContentPre.textContent = '';
        toggleOriginalContentBtn.innerHTML = '<span class="material-icons-round mr-1 text-blue-400">visibility</span> Show Original Content';

        // Clear warnings and errors
        processingWarningsDiv.classList.add('hidden');
        processingWarningsDiv.querySelector('div').innerHTML = '';
        processingErrorsDiv.classList.add('hidden');
        processingErrorsDiv.querySelector('div').innerHTML = '';

        // Make feature links available (they will load content when clicked)
        setFeatureAvailability(true);
    }

    function displayProcessingFeedback(warnings, errors) {
        const warningsDiv = processingWarningsDiv.querySelector('div');
        const errorsDiv = processingErrorsDiv.querySelector('div');

        warningsDiv.innerHTML = '';
        errorsDiv.innerHTML = '';
        processingWarningsDiv.classList.add('hidden');
        processingErrorsDiv.classList.add('hidden');

        if (warnings && warnings.length > 0) {
            warningsDiv.innerHTML = `<strong>Warnings:</strong><ul class="mt-2 ml-6 list-disc">${warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`;
            processingWarningsDiv.classList.remove('hidden');
        }

        // Display only the main error if notes generation failed, otherwise show details
        if (errors && errors.length > 0) {
            const mainError = errors.find(e => e.startsWith("Notes Generation:") || e.startsWith("Failed to retrieve content"));
            if (mainError) {
                errorsDiv.innerHTML = `<strong>Error:</strong> ${escapeHtml(mainError)}`;
            } else {
                // Show all errors if notes generation succeeded but other parts failed
                errorsDiv.innerHTML = `<strong>Errors:</strong><ul class="mt-2 ml-6 list-disc">${errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`;
            }
            processingErrorsDiv.classList.remove('hidden');
        }
    }

    function escapeHtml(unsafe) {
        if (!unsafe) return '';
        return String(unsafe)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // IMPROVED: Process Markdown and render MathJax/Mermaid with better error handling and retries
    function renderFormattedContent(element, text) {
        if (!text) {
            element.innerHTML = '';
            return;
        }

        try {
            // Store original text for potential retries
            element.dataset.originalText = text;

            // --- START: Pre-processing Step ---
            // Normalize list markers: ensure a space after '*' or '-' at the start of a line (respecting indentation)
            text = text.replace(/^(\s*[\*\-])([^\s\*])/gm, '$1 $2');
            // --- END: Pre-processing Step ---


            // 1. Protect Mermaid blocks
            const mermaidBlocks = [];
            text = text.replace(/```mermaid([\s\S]*?)```/g, (match, p1) => {
                const placeholder = `%%MERMAID_PLACEHOLDER_${mermaidBlocks.length}%%`;
                mermaidBlocks.push(p1.trim());
                // Use a pre tag for better spacing control and indicate it's code
                return `<pre class="mermaid-placeholder" data-mermaid-index="${mermaidBlocks.length - 1}">${placeholder}</pre>`;
            });


            // 2. Protect LaTeX blocks (display and inline)
            const latexBlocks = [];
            text = text.replace(/\$\$([\s\S]*?)\$\$/g, (match, p1) => {
                const placeholder = `%%LATEX_DISPLAY_${latexBlocks.length}%%`;
                latexBlocks.push(`$$${p1}$$`);
                return placeholder;
            });

            text = text.replace(/\$((?:\\\$|[^$])+)\$/g, (match, p1) => {
                // Avoid matching escaped dollar signs accidentally
                if (p1.startsWith('\\')) return match;
                const placeholder = `%%LATEX_INLINE_${latexBlocks.length}%%`;
                latexBlocks.push(`$${p1}$`);
                return placeholder;
            });

            // 3. Process Markdown
            marked.setOptions({
                gfm: true,
                breaks: true, // Render line breaks as <br>
                highlight: function(code, lang) {
                    const language = lang || 'plaintext';
                    // Ensure proper escaping within the code block
                    return `<pre><code class="language-${escapeHtml(language)}">${escapeHtml(code)}</code></pre>`;
                }
            });

            let html = marked.parse(text);

            // 4. Restore LaTeX placeholders BEFORE inserting into DOM
            html = html.replace(/%%LATEX_DISPLAY_(\d+)%%/g, (match, index) => {
                return latexBlocks[parseInt(index)];
            });

            html = html.replace(/%%LATEX_INLINE_(\d+)%%/g, (match, index) => {
                return latexBlocks[parseInt(index)];
            });

            // 5. Inject HTML into the element
            element.innerHTML = html;

            // 6. Process MathJax with retry mechanism
            if (window.MathJax && (html.includes('$') || html.includes('\\(') || html.includes('\\['))) {
                try {
                    MathJax.Hub.Queue(["Typeset", MathJax.Hub, element]);

                    // Add retry check after a delay
                    setTimeout(() => {
                        if (element && document.body.contains(element)) { // Check if element still exists
                            const mathJaxErrors = element.querySelectorAll('.mjx-error');
                            if (mathJaxErrors.length > 0) {
                                console.log("MathJax errors detected, retrying...");
                                MathJax.Hub.Queue(["Typeset", MathJax.Hub, element]);
                            }
                        }
                    }, 1500); // Increased delay slightly
                } catch (mathJaxError) {
                    console.error("MathJax rendering error:", mathJaxError);
                    // Try again with a delay
                    setTimeout(() => {
                        if (element && document.body.contains(element)) {
                            try {
                                MathJax.Hub.Queue(["Typeset", MathJax.Hub, element]);
                            } catch (retryError) {
                                console.error("MathJax retry failed:", retryError);
                            }
                        }
                    }, 1500);
                }
            }

            // 7. Process Mermaid Placeholders using mermaid.run()
            const mermaidPlaceholders = element.querySelectorAll('.mermaid-placeholder');
            if (mermaidPlaceholders.length > 0 && window.mermaid) {
                mermaidPlaceholders.forEach(placeholderPre => {
                     const index = parseInt(placeholderPre.dataset.mermaidIndex);
                     const mermaidSyntax = mermaidBlocks[index];
                     if (mermaidSyntax) {
                         // Replace placeholder text with actual syntax inside a div with class="mermaid"
                         const mermaidDiv = document.createElement('div');
                         mermaidDiv.className = 'mermaid';
                         mermaidDiv.textContent = mermaidSyntax; // Put syntax here for mermaid.run()
                         placeholderPre.parentNode.replaceChild(mermaidDiv, placeholderPre);
                     }
                });

                // Call mermaid.run() once after replacing all placeholders
                try {
                    console.log(`Found ${mermaidPlaceholders.length} mermaid diagrams to render.`);
                    mermaid.run({
                        nodes: element.querySelectorAll('.mermaid') // Target only within the current element
                    }).catch(err => {
                         console.error("Error running mermaid.run():", err);
                         // Optionally replace failed diagrams with error message
                         element.querySelectorAll('.mermaid').forEach(div => {
                             if (!div.querySelector('svg')) { // Check if rendering didn't happen
                                 div.innerHTML = `<pre class="text-red-500 p-2 bg-gray-800 rounded">Error rendering diagram: ${err.message || err}</pre>`;
                             }
                         });
                    });
                } catch (runError) {
                     console.error("Error calling mermaid.run():", runError);
                }
            }


            // 8. Handle inline source links (Keep as is)
            const sourceRegex = /\[\[(Source|Web Source) (\d+): (https?:\/\/[^\s\]]+)\]\]/g;
            const citationRegex = /\[(Source|Web Source) (\d+)\]/g;
            const sources = {};

            // First pass: extract all source definitions
            element.innerHTML = element.innerHTML.replace(sourceRegex, (match, type, num, url) => {
                sources[`${type} ${num}`] = url;
                return '';
            });

            // Second pass: replace citations with links
            element.innerHTML = element.innerHTML.replace(citationRegex, (match, type, num) => {
                const ref = `${type} ${num}`;
                if (sources[ref]) {
                    return `<a href="${escapeHtml(sources[ref])}" target="_blank" rel="noopener noreferrer" class="source-link">[${escapeHtml(ref)}]</a>`;
                }
                return match;
            });

        } catch (error) {
            console.error("Error rendering formatted content:", error);
            element.innerHTML = `<p class="text-red-500">Error displaying content.</p><pre>${escapeHtml(text)}</pre>`;
        }
    }


    // --- Event Listeners ---
    function setupEventListeners() {
        // Sidebar Navigation
        sidebarLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                if (link.disabled) return;
                const viewId = e.currentTarget.getAttribute('data-view');
                switchView(viewId);
            });
        });

        // Sidebar Toggle (Mobile)
        toggleSidebarBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed-mobile');
            sidebarOverlay.classList.toggle('hidden');

            // Lock/unlock body scroll when sidebar is open/closed on mobile
            if (!sidebar.classList.contains('collapsed-mobile')) {
                document.body.style.overflow = 'hidden'; // Prevent background scrolling
            } else {
                document.body.style.overflow = 'auto';
            }
        });

        // Sidebar overlay click handler
        sidebarOverlay.addEventListener('click', () => {
            sidebar.classList.add('collapsed-mobile');
            sidebarOverlay.classList.add('hidden');
            document.body.style.overflow = 'auto';
        });

        // Sidebar Collapse/Expand (Desktop)
        collapseSidebarDesktopBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed-desktop');
            const isCollapsed = sidebar.classList.contains('collapsed-desktop');
            if (isCollapsed) {
                sidebar.style.width = '68px';
                mainContent.style.marginLeft = '68px';
                collapseIcon.classList.add('hidden');
                expandIcon.classList.remove('hidden');
                collapseText.textContent = '';
            } else {
                sidebar.style.width = '280px';
                mainContent.style.marginLeft = '280px';
                collapseIcon.classList.remove('hidden');
                expandIcon.classList.add('hidden');
                collapseText.textContent = 'Collapse';
            }

            // Save preference
            appState.preferences.sidebarCollapsed = isCollapsed;
            savePreferences();
        });

        // Download format preference
        downloadFormatSelect.addEventListener('change', () => {
            appState.preferences.lastUsedDownloadFormat = downloadFormatSelect.value;
            savePreferences();
        });

        // Add keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Only process if not in an input field
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            // Ctrl+/ to toggle sidebar
            if (e.ctrlKey && e.key === '/') {
                e.preventDefault();
                collapseSidebarDesktopBtn.click();
            }

            // Alt+1 through Alt+6 for navigation
            if (e.altKey && '123456'.includes(e.key)) {
                e.preventDefault();
                const viewIndex = parseInt(e.key) - 1;
                const viewLinks = Array.from(sidebarLinks);

                if (viewLinks[viewIndex] && !viewLinks[viewIndex].disabled) {
                    viewLinks[viewIndex].click();
                }
            }
        });

        // Input View: Process Content Button
        processContentBtn.addEventListener('click', handleProcessContent);

        // Input View: Drag and Drop
        setupDragAndDrop();

        // Input View: File Input Change
        filesInput.addEventListener('change', handleFileSelectionChange);

        // Input View: Update button state on input change
        [urlsInput, topicInput, descriptionInput].forEach(input => {
            input.addEventListener('input', updateProcessButtonState);
        });

        // Notes View: Download Button
        downloadNotesBtn.addEventListener('click', handleDownloadNotes);

        // Notes View: Toggle Original Content
        toggleOriginalContentBtn.addEventListener('click', handleToggleOriginalContent);

        // Quiz View: Generate More Button
        generateMoreQuestionsBtn.addEventListener('click', () => {
            quizOptionsDiv.classList.toggle('hidden');
        });

        // Quiz View: Apply Options Button
        applyQuizOptionsBtn.addEventListener('click', () => {
            handleGenerateMoreQuestions();
            quizOptionsDiv.classList.add('hidden');
        });

        // Quiz View: Submit Button
        submitQuizBtn.addEventListener('click', handleSubmitQuiz);

        // Flashcards View: Generate More Button
        generateMoreFlashcardsBtn.addEventListener('click', handleGenerateMoreFlashcards);

        // Flashcards View: Navigation/Flip Buttons
        prevCardBtn.addEventListener('click', showPreviousFlashcard);
        nextCardBtn.addEventListener('click', showNextFlashcard);
        flipCardBtn.addEventListener('click', flipFlashcard);

        // Mind Map View: Generate Button
        generateMindmapBtn.addEventListener('click', handleGenerateMindmap);

        // Chat View: Send Button & Enter Key
        sendMessageBtn.addEventListener('click', handleSendChatMessage);
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendChatMessage();
            }
        });

        // Add resize listener to make textarea auto-grow
        chatInput.addEventListener('input', () => {
            chatInput.style.height = 'auto';
            chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
        });

        // --- Mindmap Fullscreen Listeners ---
        mindmapFullscreenBtn.addEventListener('click', enterMindmapFullscreen);
        mindmapExitFullscreenBtn.addEventListener('click', exitMindmapFullscreen);

        // Add Escape key listener to exit fullscreen
        document.addEventListener('keydown', (e) => {
            // Check if mindmap fullscreen is active AND escape key is pressed
            if (document.body.classList.contains('mindmap-fullscreen-active') && e.key === 'Escape') {
                exitMindmapFullscreen();
            }
        });
    }

    // --- Drag & Drop Logic ---
    function setupDragAndDrop() {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dragDropArea.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        ['dragenter', 'dragover'].forEach(eventName => {
            dragDropArea.addEventListener(eventName, () => {
                dragDropArea.classList.add('drag-active');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dragDropArea.addEventListener(eventName, () => {
                dragDropArea.classList.remove('drag-active');
            }, false);
        });

        dragDropArea.addEventListener('drop', handleDrop, false);
        dragDropArea.addEventListener('click', (event) => {
            // Find the label element associated with the file input
            const labelElement = dragDropArea.querySelector('label[for="files-input"]');
            if (labelElement && labelElement.contains(event.target)) {
                return;
            }
            filesInput.click();
        });
    }

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (!files || files.length === 0) return;
        handleFiles(files);
    }

    function handleFileSelectionChange() {
        if (!filesInput.files || filesInput.files.length === 0) return;
        handleFiles(filesInput.files);
        // Reset file input to allow selecting the same file again if removed
        filesInput.value = '';
    }

    function handleFiles(files) {
        const allowedTypes = [
            'application/pdf',
            'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac',
            'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/mpeg',
            'image/jpeg', 'image/png', 'image/webp',
            'text/plain', 'text/markdown',
            'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        ];
        const maxFileSize = 100 * 1024 * 1024; // 100 MB

        Array.from(files).forEach(file => {
            const fileId = `${file.name}-${file.size}-${file.lastModified}`;

            // Check size
            if (file.size > maxFileSize) {
                alert(`File ${file.name} is too large (Max size: ${maxFileSize / (1024*1024)} MB).`);
                return;
            }

            if (!appState.selectedFiles.has(fileId)) {
                appState.selectedFiles.set(fileId, file);
            }
        });

        updateFileListDisplay();
        updateProcessButtonState();
    }

    function updateFileListDisplay() {
        selectedFilesDiv.innerHTML = '';
        if (appState.selectedFiles.size === 0) {
            fileInputLabel.textContent = 'Browse Files';
            return;
        }

        fileInputLabel.textContent = `${appState.selectedFiles.size} file(s) selected`;

        appState.selectedFiles.forEach((file, fileId) => {
            const fileElement = document.createElement('div');
            fileElement.className = 'flex items-center justify-between p-2 bg-gray-700 rounded-lg';

            // Get file type icon
            let fileIcon = 'description'; // default icon
            if (file.type.includes('image')) fileIcon = 'image';
            else if (file.type.includes('audio')) fileIcon = 'audio_file';
            else if (file.type.includes('video')) fileIcon = 'video_file';
            else if (file.type.includes('pdf')) fileIcon = 'picture_as_pdf';

            fileElement.innerHTML = `
                <div class="flex items-center flex-grow overflow-hidden">
                    <span class="material-icons-round text-gray-400 mr-2">${fileIcon}</span>
                    <span class="text-gray-300 truncate">${escapeHtml(file.name)} <span class="text-gray-500 text-xs">(${(file.size / 1024).toFixed(1)} KB)</span></span>
                </div>
                <button class="text-red-400 hover:text-red-300 ml-2 p-1 rounded hover:bg-gray-600" data-file-id="${fileId}">
                    <span class="material-icons-round text-sm">close</span>
                </button>
            `;

            fileElement.querySelector('button').addEventListener('click', function() {
                appState.selectedFiles.delete(fileId);
                updateFileListDisplay();
                updateProcessButtonState();
            });

            selectedFilesDiv.appendChild(fileElement);
        });
    }

    function updateProcessButtonState() {
        const urls = urlsInput.value.trim();
        const topic = topicInput.value.trim();
        const description = descriptionInput.value.trim();
        const files = appState.selectedFiles.size > 0;

        // Enable if at least one URL OR one file OR (topic AND description) is provided
        const canProcess = urls || files || (topic && description);
        processContentBtn.disabled = !canProcess;
    }

    // --- API Call Functions ---
    async function apiCall(endpoint, options = {}, retries = 3) {
        const defaultHeaders = {
            // Content-Type is set based on options.body type below
            'Accept': 'application/json',
        };

        const config = {
            ...options,
            headers: {
                ...defaultHeaders,
                ...options.headers,
            },
        };

        // Set Content-Type header if body is present and it's not FormData
        if (config.body && !(config.body instanceof FormData)) {
            config.headers['Content-Type'] = 'application/json';
        } else if (config.body instanceof FormData) {
            // Let the browser set the Content-Type for FormData
            delete config.headers['Content-Type'];
        }


        // Create AbortController for timeout
        const controller = new AbortController();
        
        // UPDATED TIMEOUT LOGIC:
        let timeoutDuration = 60000; // Default 1 min for general calls like chat
        if (endpoint.includes('process-content')) {
            timeoutDuration = 300000; // 5 minutes for initial content processing
        } else if (endpoint.includes('/api/generate-quizzes') ||
                   endpoint.includes('/api/generate-flashcards') ||
                   endpoint.includes('/api/generate-mindmap')) {
            timeoutDuration = 180000; // 3 minutes for these potentially long generation tasks
        }
        // END UPDATED TIMEOUT LOGIC

        const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);

        try {
            const response = await fetch(endpoint, {
                ...config,
                signal: controller.signal
            });

            // Clear timeout since request completed
            clearTimeout(timeoutId);

            // Handle different response types
            const contentType = response.headers.get("content-type");
            let data;
            let responseTextForError = ''; // Store raw text for error reporting

            if (contentType && contentType.includes("application/json")) {
                // Read text first in case JSON parsing fails
                responseTextForError = await response.text();
                try {
                    data = JSON.parse(responseTextForError);
                } catch (jsonError) {
                    console.error(`API Error (${endpoint}): Failed to parse JSON response. Status: ${response.status}`);
                    console.error("Raw Response Text:", responseTextForError.substring(0, 500) + (responseTextForError.length > 500 ? "..." : ""));
                    throw new Error(`Server returned invalid JSON (Status: ${response.status}). Check server logs.`);
                }
            } else {
                // Handle non-JSON responses (e.g., plain text errors)
                responseTextForError = await response.text();
                data = responseTextForError; // Store text as data for non-JSON
            }

            if (!response.ok) {
                // Try to extract error from JSON data, otherwise use text
                const errorMessage = (typeof data === 'object' && data && data.error)
                    ? data.error
                    : `HTTP error ${response.status}: ${response.statusText}`;
                console.error(`API Error (${endpoint}): ${errorMessage}`, data);
                const errorDetails = (typeof data === 'object' && data && data.details) ? data.details.join(', ') : '';
                // Include raw text snippet in error if parsing failed or it wasn't JSON
                const rawSnippet = (typeof data !== 'object' || !data.error) ? ` Raw Response: ${responseTextForError.substring(0, 200)}...` : '';
                throw new Error(`${errorMessage}${errorDetails ? ' - Details: ' + errorDetails : ''}${rawSnippet}`);
            }

            // Special handling for quiz response cleaning
            if (endpoint === '/api/generate-quizzes' && typeof data === 'string') {
                 console.warn("Received quiz data as string, attempting cleaning and parsing.");
                 data = cleanAndParseQuizJson(data); // Use the cleaning function
            }


            return data;

        } catch (error) {
            // Handle timeout errors
            if (error.name === 'AbortError') {
                console.error(`Request timeout for ${endpoint}`);
                throw new Error(`Request to ${endpoint} timed out after ${timeoutDuration / 1000} seconds. The server might be busy or the task is too complex. Please try again.`);
            }

            // Handle network errors with retry logic
            if (error.message.includes('Failed to fetch') && retries > 0) {
                console.warn(`Network error for ${endpoint}, retrying... (${retries} attempts left)`);

                // Exponential backoff: wait longer between each retry
                const backoffDelay = 1000 * Math.pow(2, 3 - retries); // 1s, 2s, 4s
                await new Promise(resolve => setTimeout(resolve, backoffDelay));

                // Recursively retry the request
                return apiCall(endpoint, options, retries - 1);
            }

            console.error(`Network or API call error (${endpoint}):`, error);
            // Rethrow the original or modified error
            throw error;
        }
    }

    // Utility function for debouncing API calls
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), wait);
        };
    }

    // --- Event Handlers ---
    async function handleProcessContent() {
        const urls = urlsInput.value.trim().split('\n').map(u => u.trim()).filter(u => u);
        const files = Array.from(appState.selectedFiles.values());
        const topicVal = topicInput.value.trim();
        const descriptionVal = descriptionInput.value.trim();


        if (urls.length === 0 && files.length === 0 && (!topicVal || !descriptionVal)) {
            alert('Please provide URLs, upload files, or enter both a topic and description.');
            return;
        }

        setLoading(true, 'Processing content and generating notes...');
        processingWarningsDiv.classList.add('hidden');
        processingErrorsDiv.classList.add('hidden');

        // Log what we're sending for debugging
        console.log("Processing content with:", {
            urls,
            hasFiles: files.length > 0,
            topic: topicVal ? "Yes" : "No",
            description: descriptionVal ? "Yes" : "No",
            webSearch: webSearchToggle.checked,
            generateQuiz: generateQuizToggle.checked,
            generateFlashcards: generateFlashcardsToggle.checked,
            generateMindmap: generateMindmapToggle.checked
        });

        const formData = new FormData();
        formData.append('urls', JSON.stringify(urls));
        formData.append('topic', topicVal);
        formData.append('description', descriptionVal);
        formData.append('web_search', webSearchToggle.checked);
        formData.append('generate_quiz', generateQuizToggle.checked);
        formData.append('generate_flashcards', generateFlashcardsToggle.checked);
        formData.append('generate_mindmap', generateMindmapToggle.checked);

        files.forEach(file => {
            formData.append('files', file, file.name);
        });

        let processingErrors = []; // Local array to collect errors during this run

        try {
            console.log("Sending API request to /api/process-content");
            const startTime = performance.now();

            const result = await apiCall('/api/process-content', {
                method: 'POST',
                body: formData,
            });

            const responseTime = ((performance.now() - startTime) / 1000).toFixed(2);
            console.log(`API response received and processed in ${responseTime} seconds`);


            if (!result || !result.data) {
                console.error("Missing data in response:", result);
                throw new Error("Server returned an invalid response structure");
            }

            // Store warnings from the main processing stage
            if (result.warnings && Array.isArray(result.warnings)) {
                processingErrors.push(...result.warnings.map(w => `Warning: ${w}`)); // Prefix warnings
            }

            console.log("Processing successful (main content):", result.data.content_id);
            resetAppStateForNewContent(); // Clear previous state first

            // Store core data
            appState.contentId = result.data.content_id;
            appState.notes = result.data.notes || '';
            appState.originalText = result.data.original_text || '';
            appState.title = result.data.title || 'Study Notes';
            appState.webSearchEnabled = result.data.web_search_enabled;

            // Update UI immediately with core info
            notesTitle.textContent = appState.title;

            console.log("Rendering notes content");
            if (appState.notes) {
                renderFormattedContent(notesContent, appState.notes);
                console.log("Notes rendered successfully");
            } else {
                console.warn("No notes content received from the server");
                notesContent.innerHTML = '<p class="text-yellow-500">No notes content was generated. Please try again or check the server logs.</p>';
                processingErrors.push("Notes Generation: No notes content was generated.");
            }

            // Handle initial quiz data (REPLACE logic)
            if (result.data.initial_quiz) {
                 if (result.data.initial_quiz.status === 'success' && result.data.initial_quiz.questions) {
                     appState.quizzes = [result.data.initial_quiz]; // *** REPLACE ***
                     console.log("Initial quiz loaded with", result.data.initial_quiz.questions.length, "questions");
                     displayQuiz(); // Display immediately if generated
                 } else if (result.data.initial_quiz.error) {
                     console.warn("Error generating initial quiz:", result.data.initial_quiz.error);
                     processingErrors.push(`Initial Quiz Generation: ${result.data.initial_quiz.error}`);
                     quizContent.innerHTML = `<p class="text-yellow-500 italic text-center py-10">Could not generate initial quiz: ${escapeHtml(result.data.initial_quiz.error)}</p>`;
                 } else {
                      console.warn("Initial quiz data is invalid.");
                      processingErrors.push("Initial Quiz Generation: Received invalid data structure.");
                 }
            }

            // Handle initial flashcards (REPLACE logic)
            if (result.data.initial_flashcards) {
                 if (result.data.initial_flashcards.status === 'success' && result.data.initial_flashcards.flashcards) {
                    appState.flashcards = [result.data.initial_flashcards]; // *** REPLACE ***
                    appState.currentFlashcardSetIndex = 0;
                    appState.currentFlashcardIndex = 0; // Reset index for the new set
                    console.log("Initial flashcards loaded with", result.data.initial_flashcards.flashcards.length, "cards");
                    displayFlashcards(); // Display immediately
                 } else if (result.data.initial_flashcards.error) {
                     console.warn("Error generating initial flashcards:", result.data.initial_flashcards.error);
                     processingErrors.push(`Initial Flashcard Generation: ${result.data.initial_flashcards.error}`);
                 } else {
                     console.warn("Initial flashcard data is invalid.");
                     processingErrors.push("Initial Flashcard Generation: Received invalid data structure.");
                 }
            }


            // Handle initial mindmap
            if (result.data.initial_mindmap) {
                 if (result.data.initial_mindmap.status === 'success' && result.data.initial_mindmap.mindmap_syntax) {
                    appState.mindMapSyntax = result.data.initial_mindmap.mindmap_syntax;
                    console.log("Initial mind map loaded with", appState.mindMapSyntax.length, "characters of syntax");
                    // Rendering happens when switching to the view
                 } else if (result.data.initial_mindmap.error) {
                     console.warn("Error generating initial mind map:", result.data.initial_mindmap.error);
                     processingErrors.push(`Initial Mind Map Generation: ${result.data.initial_mindmap.error}`);
                 } else {
                     console.warn("Initial mind map data is invalid.");
                     processingErrors.push("Initial Mind Map Generation: Received invalid data structure.");
                 }
            }

            // Display collected warnings/errors
            displayProcessingFeedback(processingErrors, null); // Pass all collected issues as warnings

            // Switch to notes view after successful processing
            switchView('notes-view');

        } catch (error) {
            console.error("Error processing content:", error);
            // Display the main error from apiCall
            displayProcessingFeedback(null, [error.message]);
            setFeatureAvailability(false); // Features require content
        } finally {
            setLoading(false);
        }
    }


    function handleToggleOriginalContent() {
        if (originalContentContainer.classList.contains('hidden')) {
            // Only populate if it hasn't been populated or content changed
            if (!originalContentPre.textContent || originalContentPre.dataset.contentId !== appState.contentId) {
                originalContentPre.textContent = appState.originalText;
                originalContentPre.dataset.contentId = appState.contentId;
            }
            originalContentContainer.classList.remove('hidden');
            toggleOriginalContentBtn.innerHTML = '<span class="material-icons-round mr-1 text-blue-400">visibility_off</span> Hide Original Content';
        } else {
            originalContentContainer.classList.add('hidden');
            toggleOriginalContentBtn.innerHTML = '<span class="material-icons-round mr-1 text-blue-400">visibility</span> Show Original Content';
        }
    }

    // Function to clean and parse potentially malformed quiz JSON
    function cleanAndParseQuizJson(jsonString) {
        if (!jsonString || typeof jsonString !== 'string') {
            throw new Error("Invalid input: Expected a JSON string.");
        }
        console.log("Attempting to clean quiz JSON string...");
        try {
            // Remove specific problematic patterns observed in logs
            // Regex to remove 'Partial Transcript Snippet:"..."' lines, potentially followed by a comma
            const cleanedString = jsonString.replace(/^\s*Partial Transcript Snippet:".*?"\s*,?\s*$/gm, '');

            // Attempt to parse the cleaned string
            const parsedData = JSON.parse(cleanedString);

            // Basic validation
            if (!Array.isArray(parsedData)) {
                 // If it parsed but isn't an array, wrap it? Or error? Let's error for now.
                 // If the API consistently returns a single object instead of array, adjust here.
                 console.warn("Parsed quiz data is not an array:", parsedData);
                 // Let's assume the API should return an object with a 'questions' array
                 if (parsedData && Array.isArray(parsedData.questions)) {
                     console.log("Found questions array inside object.");
                     return parsedData; // Return the object containing the questions array
                 }
                 throw new Error("Cleaned quiz JSON is not in the expected array format.");
            }

             // If it's an array, assume it's the questions array directly
             // Wrap it in the expected structure { quiz_id, questions, status }
             return {
                 quiz_id: "cleaned-" + Date.now(),
                 questions: parsedData,
                 status: "success"
             };

        } catch (error) {
            console.error("Failed to clean and parse quiz JSON:", error);
            console.error("Original string snippet:", jsonString.substring(0, 500) + "...");
            // Re-throw a more specific error
            throw new Error(`Failed to parse quiz JSON after cleaning: ${error.message}`);
        }
    }


    async function handleGenerateMoreQuestions() {
        if (!appState.notes && !appState.originalText) {
            alert("Please process content first to generate notes.");
            return;
        }

        const selectedTypes = Array.from(quizOptionsDiv.querySelectorAll('input[name="quiz_type"]:checked')).map(cb => cb.value);
        const numQuestions = parseInt(numQuestionsInput.value) || 5;
        const difficultySelect = document.getElementById('quiz-difficulty-select'); // Get the new dropdown
        const difficulty = difficultySelect ? difficultySelect.value : 'Apply'; // Read selected difficulty

        if (selectedTypes.length === 0) {
            alert("Please select at least one question type.");
            return;
        }

        setLoading(true, `Generating ${numQuestions} new questions (Level: ${difficulty})...`);
        // Clear previous errors/placeholders in quiz content area
        quizContent.innerHTML = `
            <div class="text-center py-10">
                <div class="loading-spinner mb-4 mx-auto"></div>
                <p class="text-gray-400">Generating questions...</p>
            </div>`;
        quizActions.classList.add('hidden'); // Hide actions while generating

        try {
            // Send empty existing_questions as we are replacing
            const response = await apiCall('/api/generate-quizzes', {
                method: 'POST',
                body: JSON.stringify({
                    notes: appState.notes,
                    original_text: appState.originalText,
                    existing_questions: '[]', // Send empty list for replacement logic
                    question_types: selectedTypes,
                    num_questions: numQuestions,
                    difficulty: difficulty // Send difficulty
                })
            });

            if (response && response.status === "success" && response.questions) {
                appState.quizzes = [response]; // *** REPLACE *** current quizzes with the new set
                displayQuiz(); // Display the new set of questions
                console.log(`Generated ${response.questions.length} new questions successfully.`);
            } else {
                 const errorMsg = (response && response.error) ? response.error : "Invalid response or failed to generate questions.";
                 throw new Error(errorMsg);
            }

        } catch (error) {
            console.error("Error generating more questions:", error);
            // Display error within the quiz content area
            quizContent.innerHTML = `
                <div class="card bg-red-900 border-red-700 text-red-200 p-4 text-center">
                    <span class="material-icons-round text-3xl mb-2">error_outline</span>
                    <p>Error generating questions:</p>
                    <p class="mt-1 text-sm">${escapeHtml(error.message)}</p>
                    <button onclick="document.getElementById('generate-more-questions-btn').click()" class="btn-secondary mt-4">Try Again</button>
                </div>
            `;
        } finally {
            setLoading(false);
            quizOptionsDiv.classList.add('hidden'); // Hide options after attempting generation
        }
    }

    function displayQuiz() {
        quizContent.innerHTML = ''; // Clear previous content
        appState.quizAnswers = {};
        appState.quizResults = {};
        submitQuizBtn.disabled = true;
        quizActions.classList.add('hidden');
        quizResultsSummary.textContent = '';

        // Since we replace, there's only ever one quiz set at index 0
        const currentQuizSet = appState.quizzes[0];

        if (!currentQuizSet || !Array.isArray(currentQuizSet.questions) || currentQuizSet.questions.length === 0) {
            quizContent.innerHTML = `
                <div class="text-center py-16">
                    <span class="material-icons-round text-gray-500 text-5xl mb-4">quiz</span>
                    <p class="text-gray-500 italic">No quiz questions generated yet. Use the options above to generate some.</p>
                </div>
            `;
             // Hide options if no questions generated
            // quizOptionsDiv.classList.add('hidden'); // Keep options visible
            return;
        }

        quizActions.classList.remove('hidden'); // Show submit button etc.
        const questionsToDisplay = currentQuizSet.questions;

        questionsToDisplay.forEach((q, displayIndex) => {
            if (!q || !q.type || !q.question) {
                console.warn("Skipping invalid question object:", q);
                return;
            }

             // Use displayIndex directly as the identifier within this set
            const questionGlobalIndex = String(displayIndex); // Use simple index for replacement logic

            // Sanitize MCQ options
            if (q.type === 'MCQ') {
                if (!Array.isArray(q.options) || q.options.length < 3) { // Need at least 3 for plausible distractors
                    console.warn(`MCQ question ${displayIndex + 1} has invalid options. Skipping.`, q.options);
                    return; // Skip rendering this question
                }
                q.options = q.options.map(opt => String(opt)); // Ensure strings
            }
            // Sanitize Matching options
             if (q.type === 'Matching') {
                 if (!q.options || !Array.isArray(q.options.column_a) || q.options.column_a.length !== 5 ||
                     !Array.isArray(q.options.column_b) || q.options.column_b.length !== 5 ||
                     !Array.isArray(q.correct_answer) || q.correct_answer.length !== 5) {
                     console.warn(`Matching question ${displayIndex + 1} has invalid structure (needs 5 items per column/answer). Skipping.`, q);
                     return; // Skip rendering this question
                 }
                 // Ensure items are strings
                 q.options.column_a = q.options.column_a.map(item => String(item));
                 q.options.column_b = q.options.column_b.map(item => String(item));
             }


            const questionDiv = document.createElement('div');
            questionDiv.className = 'quiz-question card mb-6';
            questionDiv.dataset.globalIndex = questionGlobalIndex; // Use the simple index

            let optionsHtml = '';
            switch (q.type) {
                case 'MCQ':
                    optionsHtml = `<div class="space-y-3">`;
                    q.options.forEach((option, optIndex) => {
                        const safeValue = escapeHtml(option);
                        const optionId = `q${displayIndex}_opt${optIndex}`;
                        optionsHtml += `
                            <div class="option-container">
                                <label for="${optionId}" class="flex items-start">
                                    <input type="radio" id="${optionId}" name="q${displayIndex}" value="${safeValue}" data-global-index="${questionGlobalIndex}" class="mr-3 mt-1 form-radio text-blue-500 bg-gray-700 border-gray-600 focus:ring-blue-400 focus:ring-opacity-50">
                                    <span class="option-text flex-1"></span>
                                </label>
                            </div>`;
                    });
                    optionsHtml += `</div>`;
                    break;
                case 'True/False':
                     optionsHtml = `<div class="space-y-3">`;
                     ["True", "False"].forEach((option, optIndex) => {
                         const optionId = `q${displayIndex}_opt${optIndex}`;
                         optionsHtml += `
                             <div class="option-container">
                                 <label for="${optionId}" class="flex items-center">
                                     <input type="radio" id="${optionId}" name="q${displayIndex}" value="${option}" data-global-index="${questionGlobalIndex}" class="mr-3 form-radio text-blue-500 bg-gray-700 border-gray-600 focus:ring-blue-400 focus:ring-opacity-50">
                                     <span>${option}</span>
                                 </label>
                             </div>`;
                     });
                     optionsHtml += `</div>`;
                    break;
                case 'Fill_in_the_Blank':
                    optionsHtml = `
                        <div class="mt-4">
                            <input type="text" name="q${displayIndex}" data-global-index="${questionGlobalIndex}" placeholder="Type your answer here..." class="input-field">
                        </div>`;
                    break;
                case 'Short_Answer':
                    optionsHtml = `
                        <div class="mt-4">
                            <textarea name="q${displayIndex}" data-global-index="${questionGlobalIndex}" rows="3" placeholder="Type your answer here..." class="input-field"></textarea>
                        </div>`;
                    break;
                case 'Matching':
                    // Guaranteed to have 5 items by validation check above
                    const colA = q.options.column_a;
                    const colB = q.options.column_b;

                    optionsHtml = `<div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4 matching-container" data-global-index="${questionGlobalIndex}">`;

                    // Column A (Items A-E)
                    optionsHtml += `<div class="col-a">
                        <h4 class="text-gray-300 font-medium mb-2">Column A</h4>
                        <ul class="space-y-3">`;
                    colA.forEach((item, index) => {
                        optionsHtml += `<li class="p-3 border border-gray-600 rounded-lg bg-gray-700 flex items-center">
                            <span class="font-bold mr-3">${String.fromCharCode(65 + index)}.</span>
                            <div class="term-a-${index} flex-grow"></div>
                        </li>`;
                    });
                    optionsHtml += `</ul></div>`;

                    // Column B (Dropdowns 1-5)
                    optionsHtml += `<div class="col-b">
                        <h4 class="text-gray-300 font-medium mb-2">Column B</h4>
                        <ul class="space-y-3">`;
                    colB.forEach((item, index) => {
                        optionsHtml += `<li class="p-3 border border-gray-600 rounded-lg bg-gray-700 flex items-center">
                            <select name="q${displayIndex}_match${index}" data-col-b-index="${index}" class="select-field w-24 mr-3">
                                <option value="">Select</option>
                                ${colA.map((_, aIndex) => `<option value="${aIndex}">${String.fromCharCode(65 + aIndex)}</option>`).join('')}
                            </select>
                            <div class="term-b-${index} flex-grow"></div>
                        </li>`;
                    });
                    optionsHtml += `</ul></div>`;

                    optionsHtml += `</div>`;
                    break;
                // Default case kept for robustness
                default:
                    optionsHtml = `<p class="text-yellow-400 mt-3">Unsupported question type: ${escapeHtml(q.type)}</p>
                        <div class="mt-2">
                            <textarea name="q${displayIndex}" data-global-index="${questionGlobalIndex}" rows="3" placeholder="Type your answer here..." class="input-field"></textarea>
                        </div>`;
            }


            questionDiv.innerHTML = `
                <div class="mb-6">
                    <div class="flex items-start">
                        <span class="font-semibold text-gray-400 mr-2">${displayIndex + 1}.</span>
                        <div class="question-text text-lg font-medium text-gray-100 flex-grow"></div>
                        <span class="ml-2 text-sm text-gray-400 italic" title="Target Bloom's Level: ${escapeHtml(q.difficulty || 'N/A')}">${
                          q.type === 'MCQ' ? 'Multiple Choice' :
                          q.type === 'True/False' ? 'True/False' :
                          q.type === 'Fill_in_the_Blank' ? 'Fill in the Blank' :
                          q.type === 'Matching' ? 'Matching (5x5)' :
                          q.type === 'Short_Answer' ? 'Short Answer' : escapeHtml(q.type)}</span>
                    </div>
                </div>
                <div class="options-area">${optionsHtml}</div>
                <div class="feedback-container mt-6 hidden"></div>
            `;

            // Render question text and options using the formatting function
            renderFormattedContent(questionDiv.querySelector('.question-text'), q.question);
            if (q.type === 'MCQ') {
                q.options.forEach((option, optIndex) => {
                    const optionLabel = questionDiv.querySelector(`#q${displayIndex}_opt${optIndex}`)?.parentNode.querySelector('.option-text');
                    if (optionLabel) renderFormattedContent(optionLabel, option);
                });
            } else if (q.type === 'Matching') {
                 q.options.column_a.forEach((item, index) => {
                     const el = questionDiv.querySelector(`.term-a-${index}`);
                     if (el) renderFormattedContent(el, item);
                 });
                 q.options.column_b.forEach((item, index) => {
                     const el = questionDiv.querySelector(`.term-b-${index}`);
                     if (el) renderFormattedContent(el, item);
                 });
            }

            quizContent.appendChild(questionDiv);
        });

        // Add event listener for input changes to enable submit button
        quizContent.addEventListener('input', handleQuizInputChange);

        // Re-run MathJax if necessary
        if (window.MathJax && quizContent.innerHTML.includes('$')) {
            MathJax.Hub.Queue(["Typeset", MathJax.Hub, quizContent]);
        }
    }

    function handleQuizInputChange(event) {
        const target = event.target;
        // Get the index from the parent question div, not necessarily the input itself
        const questionDiv = target.closest('.quiz-question');
        if (!questionDiv) return; // Should not happen if event is inside a question

        const globalIndex = questionDiv.dataset.globalIndex;
        if (globalIndex === undefined) return; // Cannot identify question

        // --- Store the answer (logic remains mostly the same) ---
        if (target.type === 'radio' && target.checked) {
            appState.quizAnswers[globalIndex] = target.value;
        } else if (target.type === 'text' || target.tagName === 'TEXTAREA') {
            appState.quizAnswers[globalIndex] = target.value.trim();
        } else if (target.tagName === 'SELECT' && target.closest('.matching-container')) {
            const matchingContainer = target.closest('.matching-container');
            const qGlobalIndex = matchingContainer.dataset.globalIndex; // Get index from container
            const selects = matchingContainer.querySelectorAll('select');
            const answers = {};
            // Store answers for matching
            selects.forEach(select => {
                const colBIndex = select.dataset.colBIndex;
                answers[colBIndex] = select.value; // Store selected Column A index for this Column B item
            });
            appState.quizAnswers[qGlobalIndex] = answers;
        }

        // --- Check if ALL *RENDERED* questions are answered ---
        const renderedQuestionDivs = quizContent.querySelectorAll('.quiz-question');
        let allAnswered = true; // Assume true initially

        // Iterate through the questions actually present in the DOM
        renderedQuestionDivs.forEach(qDiv => {
            const idx = qDiv.dataset.globalIndex;
            const answer = appState.quizAnswers[idx];
            const matchingContainer = qDiv.querySelector('.matching-container'); // Check if it's a matching question

            if (matchingContainer) {
                // Matching question: check if the answer object exists and all selects have a value
                if (!answer || typeof answer !== 'object') {
                    allAnswered = false;
                    return; // Stop checking this question if answer object doesn't exist
                }
                const selects = matchingContainer.querySelectorAll('select');
                // Check if every select in *this* matching question has a non-empty value
                const allSelectsAnswered = Array.from(selects).every(select => select.value !== "");
                if (!allSelectsAnswered) {
                    allAnswered = false;
                }
            } else {
                // Other question types: check if answer is defined and not an empty string
                if (answer === undefined || answer === '') {
                    allAnswered = false;
                }
            }
        });
        submitQuizBtn.disabled = !allAnswered;
    }

    // --- Place this updated function in main.js ---
    // (Replace the existing handleSubmitQuiz function AGAIN)
    async function handleSubmitQuiz() {
        // Use the questions currently displayed in the DOM as the source of truth for iteration
        const renderedQuestionDivs = quizContent.querySelectorAll('.quiz-question');
        if (renderedQuestionDivs.length === 0) {
            console.log("No questions rendered to submit.");
            return;
        }

        console.log("Submitting quiz answers for rendered questions:", appState.quizAnswers);
        setLoading(true, "Evaluating answers...");
        submitQuizBtn.disabled = true; // Disable while processing
        appState.quizResults = {}; // Clear previous results

        // Get the actual question data from the current quiz set in appState
        const currentQuizSet = appState.quizzes[0];
        if (!currentQuizSet || !Array.isArray(currentQuizSet.questions)) {
            console.error("Quiz data is missing or invalid in appState.");
            setLoading(false);
            alert("Error: Could not find quiz data to evaluate against.");
            return;
        }
        const questionsData = currentQuizSet.questions;

        let correctCount = 0;
        const evaluationPromises = [];

        // Iterate through the *rendered* question divs
        renderedQuestionDivs.forEach((questionDiv) => {
            const displayIndexStr = questionDiv.dataset.globalIndex; // Get the simple index (string)
            // Convert index back to number to access array
            const displayIndex = parseInt(displayIndexStr);
            if (isNaN(displayIndex) || displayIndex < 0 || displayIndex >= questionsData.length) {
                 console.warn(`Invalid index ${displayIndexStr} found on rendered question div. Skipping.`);
                 return; // Skip if index is bad
            }

            // Get the corresponding question data using the numeric index
            const q = questionsData[displayIndex];

            // Ensure question data exists for this index
            if (!q) {
                 console.warn(`No question data found at index ${displayIndex}. Skipping.`);
                 return;
            }

            const feedbackDiv = questionDiv.querySelector('.feedback-container');
            feedbackDiv.innerHTML = ''; // Clear previous feedback
            feedbackDiv.classList.add('hidden'); // Hide initially

            const userAnswer = appState.quizAnswers[displayIndexStr]; // Use the string index to get answer
            let isCorrect = false;
            let score = 0;
            let feedbackText = q.explanation || "No explanation provided.";

            // --- Evaluation Logic (Mostly unchanged, but uses correct 'q' and 'userAnswer') ---
            try {
                switch (q.type) {
                    case 'MCQ':
                    case 'True/False':
                        isCorrect = userAnswer === String(q.correct_answer);
                        if (isCorrect) correctCount++;
                        feedbackText = `Your Answer: ${escapeHtml(userAnswer || 'N/A')}. ${isCorrect ? 'Correct!' : 'Incorrect.'} ${q.explanation || ''}`;
                        appState.quizResults[displayIndexStr] = { correct: isCorrect, feedback_html: feedbackText };
                        break;

                    case 'Fill_in_the_Blank':
                        const correctAnswers = Array.isArray(q.correct_answer) ? q.correct_answer : [q.correct_answer];
                        isCorrect = correctAnswers.some(ans =>
                             userAnswer && typeof userAnswer === 'string' && ans && typeof ans === 'string' &&
                             userAnswer.trim().toLowerCase() === ans.trim().toLowerCase()
                        );
                        if (isCorrect) correctCount++;
                        feedbackText = `Your Answer: ${escapeHtml(userAnswer || 'N/A')}. Correct Answer(s): ${correctAnswers.map(a => escapeHtml(a || '')).join('/')}. ${isCorrect ? 'Correct!' : 'Incorrect.'} ${q.explanation || ''}`;
                        appState.quizResults[displayIndexStr] = { correct: isCorrect, feedback_html: feedbackText };
                        break;

                    case 'Matching':
                        const correctMapping = {};
                        let matchCorrectCount = 0;
                        const totalMatches = (q.options && Array.isArray(q.options.column_a)) ? q.options.column_a.length : 0;

                        try {
                            if (!Array.isArray(q.correct_answer) || q.correct_answer.length !== 5) { // Ensure 5 answers
                                throw new Error("Invalid correct_answer format for matching.");
                            }
                            q.correct_answer.forEach(mapString => {
                                if (typeof mapString === 'string') {
                                    const parts = mapString.split('-');
                                    if (parts.length === 2) {
                                        correctMapping[parts[1]] = parts[0]; // bIndex -> aIndex
                                    }
                                }
                            });

                            if (userAnswer && typeof userAnswer === 'object') {
                                Object.entries(userAnswer).forEach(([bIndex, selectedAIndex]) => {
                                    if (correctMapping[bIndex] === selectedAIndex) {
                                        matchCorrectCount++;
                                    }
                                });
                            }

                            isCorrect = totalMatches > 0 && matchCorrectCount === totalMatches;
                            if (isCorrect) correctCount++;

                            let correctPairsHtml = "<li>Could not determine correct pairs.</li>";
                            if (q.options && Array.isArray(q.options.column_a) && Array.isArray(q.options.column_b)) {
                                correctPairsHtml = q.correct_answer.map(map => {
                                     if (typeof map !== 'string') return '<li>Invalid map format</li>';
                                     const [aIndex, bIndex] = map.split('-');
                                     const aText = q.options.column_a[aIndex] ?? `Item A${aIndex}`;
                                     const bText = q.options.column_b[bIndex] ?? `Item B${bIndex}`;
                                     return `<li class="my-1">${escapeHtml(String.fromCharCode(65 + parseInt(aIndex)))}. ${escapeHtml(aText)} → ${escapeHtml(bText)}</li>`;
                                }).join('');
                            }
                            feedbackText = `You matched ${matchCorrectCount} out of ${totalMatches} correctly. ${isCorrect ? 'All Correct!' : 'Partially Correct.'}<br>Correct pairings:<ul class="list-disc ml-5 mt-2">${correctPairsHtml}</ul>${q.explanation || ''}`;
                        } catch (matchError) {
                            console.error(`Error processing matching answer for index ${displayIndexStr}:`, matchError);
                            feedbackText = "Error evaluating matching answer.";
                            isCorrect = false; // Mark as incorrect if processing failed
                        }
                        appState.quizResults[displayIndexStr] = { correct: isCorrect, feedback_html: feedbackText };
                        break;

                    case 'Short_Answer':
                        feedbackText = `<p>Evaluating your answer...</p>`;
                        // Store placeholder, push promise
                        appState.quizResults[displayIndexStr] = { correct: null, feedback_html: feedbackText };
                        evaluationPromises.push(
                            apiCall('/api/evaluate-answer', { // Ensure apiCall is defined and working
                                method: 'POST',
                                body: JSON.stringify({
                                    question: q.question,
                                    ideal_answer: q.correct_answer,
                                    user_answer: userAnswer,
                                    notes_context: appState.notes // Send relevant notes
                                })
                            }).then(evalResult => {
                                if (evalResult.status === 'success') {
                                    score = evalResult.score;
                                    isCorrect = score >= 7; // Consider 7+ as correct for summary
                                    // Increment count inside the promise resolution only if correct
                                    if (isCorrect) {
                                        correctCount++; // Increment happens here *after* evaluation
                                    }
                                    const scoreColor = score >= 7 ? 'text-green-400' : (score >= 4 ? 'text-yellow-400' : 'text-red-400');
                                    feedbackText = `<p class="font-semibold">Score: <span class="${scoreColor}">${score}/10</span></p><p>${escapeHtml(evalResult.feedback)}</p>`;
                                    // Update the result object for this question
                                    appState.quizResults[displayIndexStr] = { correct: isCorrect, score: score, feedback_html: feedbackText };
                                } else {
                                    throw new Error(evalResult.error || "Evaluation failed");
                                }
                            }).catch(error => {
                                console.error(`Evaluation failed for question ${displayIndexStr}:`, error);
                                // Update result object with error message
                                appState.quizResults[displayIndexStr] = { correct: false, feedback_html: `<p class="text-red-500">Evaluation failed: ${error.message}</p>` };
                                // Do NOT increment correctCount here
                            })
                        );
                        // Need to break here so the immediate DOM update doesn't overwrite the "Evaluating..."
                        break; // Exit switch for Short_Answer

                    default:
                        feedbackText = "Cannot evaluate this question type.";
                        appState.quizResults[displayIndexStr] = { correct: false, feedback_html: feedbackText };
                }
            } catch (evalError) {
                console.error(`Error processing answer for question ${displayIndexStr}:`, evalError);
                appState.quizResults[displayIndexStr] = { correct: false, feedback_html: `<p class="text-red-500">Error evaluating this answer.</p>` };
            }

             // Disable inputs for this question *after* storing answer
             questionDiv.querySelectorAll('input, textarea, select').forEach(input => input.disabled = true);

             // For non-Short_Answer types, store result immediately.
             // For Short_Answer, the promise callback will update quizResults later.
             // We'll update the DOM for *all* questions *after* the promises resolve.

        }); // End loop through rendered questions

        // Wait for all subjective evaluations (if any) to complete
        await Promise.all(evaluationPromises);

        // --- Now update the DOM with all results ---
        renderedQuestionDivs.forEach((questionDiv) => {
             const displayIndexStr = questionDiv.dataset.globalIndex;
             const feedbackDiv = questionDiv.querySelector('.feedback-container');
             const result = appState.quizResults[displayIndexStr]; // Get the final result

             if (result && feedbackDiv) { // Check if result exists
                 const isCorrect = result.correct;
                 const feedbackHtml = result.feedback_html;

                 let statusIcon, statusClass, statusText;

                 if (isCorrect === null) { // Should only happen if evaluation promise failed badly
                     statusIcon = 'help_outline';
                     statusClass = 'text-gray-500';
                     statusText = 'Evaluation Pending/Failed';
                 } else if (isCorrect) {
                     statusIcon = 'check_circle';
                     statusClass = 'text-green-500';
                     statusText = 'Correct';
                 } else {
                     statusIcon = 'cancel';
                     statusClass = 'text-red-500';
                     statusText = 'Incorrect';
                 }

                 feedbackDiv.innerHTML = `
                     <div class="border-t border-gray-700 pt-4">
                         <div class="flex items-center mb-2">
                             <span class="material-icons-round ${statusClass} mr-2">${statusIcon}</span>
                             <span class="font-semibold ${statusClass}">${statusText} ${result.score !== undefined ? `(Score: ${result.score}/10)` : ''}</span>
                         </div>
                         <div class="text-gray-300 text-sm feedback-content">
                             ${feedbackHtml /* Already escaped or formatted */}
                         </div>
                     </div>
                 `;

                 feedbackDiv.classList.remove('hidden'); // Show the feedback

                 // Re-run MathJax if feedback contains LaTeX (optional, based on content)
                 if (window.MathJax && feedbackHtml.includes('$')) {
                     MathJax.Hub.Queue(["Typeset", MathJax.Hub, feedbackDiv]);
                 }
             } else {
                  console.warn(`No result found or feedback div missing for index ${displayIndexStr}`);
                  if (feedbackDiv) {
                      feedbackDiv.innerHTML = `<p class="text-gray-500">Could not display feedback.</p>`;
                      feedbackDiv.classList.remove('hidden');
                  }
             }
        });


        // Update final score summary using the count of *rendered* questions
        const totalRenderedQuestions = renderedQuestionDivs.length;
        quizResultsSummary.innerHTML = `Score: <span class="text-blue-400">${correctCount}</span> / ${totalRenderedQuestions}`;
        quizResultsSummary.classList.add('animate-pulse');
        setTimeout(() => quizResultsSummary.classList.remove('animate-pulse'), 1000);

        setLoading(false);
    }


    async function handleGenerateMoreFlashcards() {
        if (!appState.notes && !appState.originalText) {
            alert("Please process content first to generate notes.");
            return;
        }

        setLoading(true, "Generating new flashcards...");
        noFlashcardsMessage.classList.add('hidden'); // Hide placeholder
        flashcardsDisplayArea.innerHTML = `
            <div class="text-center p-10">
                <div class="loading-spinner mb-4 mx-auto"></div>
                <p class="text-gray-400">Generating flashcards...</p>
            </div>`; // Show loading inside display area

        try {
            // Send empty existing_flashcards as we are replacing
            const response = await apiCall('/api/generate-flashcards', {
                method: 'POST',
                body: JSON.stringify({
                    notes: appState.notes,
                    original_text: appState.originalText,
                    existing_flashcards: '[]', // Send empty list for replacement logic
                    num_flashcards: 10 // Or get from UI if you add an input
                })
            });

            if (response.status === "success" && response.flashcards) {
                appState.flashcards = [response]; // *** REPLACE *** current flashcards
                appState.currentFlashcardSetIndex = 0; // Point to the new set
                appState.currentFlashcardIndex = 0; // Start from the first card
                // Recreate the flashcard structure within the display area
                flashcardsDisplayArea.innerHTML = `
                     <div class="flashcard-container relative mx-auto" style="height: 300px; max-width: 600px;">
                         <div id="flashcard" class="flashcard w-full h-full">
                             <div id="flashcard-front" class="flashcard-face flashcard-front"></div>
                             <div id="flashcard-back" class="flashcard-face flashcard-back"></div>
                         </div>
                     </div>
                     <div class="flex justify-center items-center gap-6 mt-8">
                         <button id="prev-card-btn" class="btn-icon" disabled>
                             <span class="material-icons-round">arrow_back</span>
                         </button>
                         <button id="flip-card-btn" class="btn-primary">
                             <span class="material-icons-round mr-1">flip</span>
                             Flip Card
                         </button>
                         <button id="next-card-btn" class="btn-icon" disabled>
                             <span class="material-icons-round">arrow_forward</span>
                         </button>
                     </div>
                     <div id="card-counter" class="text-center mt-4 text-gray-400 text-sm"></div>
                `;
                 // Re-assign DOM elements for the newly created structure
                flashcardContainer = document.getElementById('flashcard');
                flashcardFront = document.getElementById('flashcard-front');
                flashcardBack = document.getElementById('flashcard-back');
                prevCardBtn = document.getElementById('prev-card-btn');
                flipCardBtn = document.getElementById('flip-card-btn');
                nextCardBtn = document.getElementById('next-card-btn');
                cardCounter = document.getElementById('card-counter');
                // Re-attach listeners
                prevCardBtn.addEventListener('click', showPreviousFlashcard);
                nextCardBtn.addEventListener('click', showNextFlashcard);
                flipCardBtn.addEventListener('click', flipFlashcard);

                displayFlashcards(); // Display the new set
                console.log(`Generated ${response.flashcards.length} new flashcards.`);
            } else {
                throw new Error(response.error || "Failed to generate flashcards");
            }
        } catch (error) {
            console.error("Error generating more flashcards:", error);
            flashcardsDisplayArea.classList.add('hidden');
            noFlashcardsMessage.classList.remove('hidden');
            noFlashcardsMessage.innerHTML = `
                 <span class="material-icons-round text-red-500 text-5xl mb-4">error_outline</span>
                 <p class="text-red-500 italic">Error generating flashcards: ${escapeHtml(error.message)}</p>`;
        } finally {
            setLoading(false);
        }
    }

    function displayFlashcards() {
        const currentSet = appState.flashcards[appState.currentFlashcardSetIndex];

        if (!currentSet || !currentSet.flashcards || currentSet.flashcards.length === 0) {
            flashcardsDisplayArea.classList.add('hidden');
            noFlashcardsMessage.classList.remove('hidden');
            return;
        }

        flashcardsDisplayArea.classList.remove('hidden');
        noFlashcardsMessage.classList.add('hidden');

        const card = currentSet.flashcards[appState.currentFlashcardIndex];
        if (!card) return;

        renderFormattedContent(flashcardFront, card.question);
        renderFormattedContent(flashcardBack, card.answer);

        flashcardContainer.classList.remove('flipped');
        cardCounter.textContent = `Card ${appState.currentFlashcardIndex + 1} of ${currentSet.flashcards.length}`;
        updateFlashcardNavigation();
    }

    function updateFlashcardNavigation() {
        const currentSet = appState.flashcards[appState.currentFlashcardSetIndex];
        if (!currentSet) return;

        prevCardBtn.disabled = appState.currentFlashcardIndex === 0;
        nextCardBtn.disabled = appState.currentFlashcardIndex === currentSet.flashcards.length - 1;
    }

    function showPreviousFlashcard() {
        if (appState.currentFlashcardIndex > 0) {
            appState.currentFlashcardIndex--;
            displayFlashcards();
        }
    }

    function showNextFlashcard() {
        const currentSet = appState.flashcards[appState.currentFlashcardSetIndex];
        if (currentSet && appState.currentFlashcardIndex < currentSet.flashcards.length - 1) {
            appState.currentFlashcardIndex++;
            displayFlashcards();
        }
    }

    function flipFlashcard() {
        flashcardContainer.classList.toggle('flipped');
    }

    // --- Mind Map Handling ---
    async function handleGenerateMindmap() {
        if (!appState.notes && !appState.originalText) {
            alert("Please process content first to generate notes.");
            return;
        }
    
        setLoading(true, "Generating mind map syntax...");
        mindmapErrorDiv.classList.add('hidden');
        mindmapContainer.innerHTML = `
            <div class="text-center p-6">
                <div class="loading-spinner mb-4 mx-auto"></div>
                <p class="text-gray-400">Generating mind map structure...</p>
            </div>`;
    
        try {
            const response = await apiCall('/api/generate-mindmap', {
                method: 'POST',
                body: JSON.stringify({
                    notes: appState.notes,
                    original_text: appState.originalText
                })
            });
    
            if (response.status === "success" && response.mindmap_syntax) {
                appState.mindMapSyntax = response.mindmap_syntax;
                console.log("Received mind map syntax:", response.mindmap_syntax.substring(0, 100) + "...");
                // Now trigger the standardized rendering function
                ensureMindmapRendered();
            } else {
                throw new Error(response.error || "Failed to generate mind map syntax");
            }
        } catch (error) {
            console.error("Mind map generation error:", error);
            // Display error in the container
            mindmapContainer.innerHTML = `
                <div class="text-center p-6">
                    <span class="material-icons-round text-red-500 text-5xl mb-4">error_outline</span>
                    <p class="text-red-500">Failed to generate mind map: ${escapeHtml(error.message)}</p>
                    <button id="retry-mindmap-btn" class="btn-secondary mt-4">
                        <span class="material-icons-round mr-1">refresh</span>Retry
                    </button>
                </div>
            `;
            // Re-attach listener if retry button exists
            const retryBtn = document.getElementById('retry-mindmap-btn');
            if (retryBtn) {
                retryBtn.addEventListener('click', handleGenerateMindmap);
            }
        } finally {
            setLoading(false);
        }
    }

    // Main function to attempt rendering with available libraries
    function renderMindmapWithAvailableLibrary() {
        // Safety check - if container isn't available anymore, abort rendering
        if (!mindmapContainer || !document.body.contains(mindmapContainer)) {
            console.warn("Mind map container not found or not in document anymore");
            return;
        }

        // Handle missing syntax case
        if (!appState.mindMapSyntax) {
            console.log("No mind map syntax available, showing placeholder.");
            try {
                mindmapContainer.innerHTML = `
                    <div class="text-center">
                        <span class="material-icons-round text-gray-500 text-5xl mb-4">account_tree</span>
                        <p class="text-gray-500 italic">No mind map data available. Click "Generate Mind Map" to create one.</p>
                    </div>
                `;
            } catch (error) {
                console.error("Error updating empty mindmap container:", error);
            }
            return;
        }

        // Clear the container and error messages before attempting render
        try {
            mindmapContainer.innerHTML = `
                <div class="text-center p-10">
                    <div class="loading-spinner mb-4 mx-auto"></div>
                    <p class="text-gray-400">Rendering mind map...</p>
                </div>
            `;
            if (mindmapErrorDiv) {
                mindmapErrorDiv.classList.add('hidden');
                const errorContent = mindmapErrorDiv.querySelector('div');
                if (errorContent) errorContent.textContent = '';
            }
        } catch (error) {
            console.error("Error clearing mindmap container:", error);
            return; // Stop if we can't even clear the container
        }

        // Try rendering libraries in order of preference
        console.log("Attempting to render mind map visualization...");

        // Use setTimeout to ensure the loading state is rendered before heavy processing
        setTimeout(async () => { // Make async to use await for mermaid.run()
            try {
                // 1. Try Mermaid first using mermaid.run()
                if (window.mermaid && appState.librariesLoaded.mermaid) {
                    console.log("Attempting render with Mermaid using mermaid.run()...");
                    const success = await renderWithMermaidRun(); // Use await here
                    if (success) {
                        console.log("Mermaid rendering successful.");
                        return; // Success
                    }
                    console.warn("Mermaid rendering failed, trying next library.");
                } else {
                    console.log("Mermaid library not available or not loaded.");
                }

                // 2. Try Cytoscape next
                if (window.cytoscape && appState.librariesLoaded.cytoscape) {
                    console.log("Attempting render with Cytoscape...");
                    if (renderWithCytoscape()) { // renderWithCytoscape returns true on success attempt
                         console.log("Cytoscape rendering initiated.");
                         return; // Success
                    }
                    console.warn("Cytoscape rendering failed, trying next library.");
                } else {
                     console.log("Cytoscape library not available or not loaded.");
                }

                // 3. Try jsPlumb (often more complex, lower priority) - Currently disabled as it's less reliable
                /*
                if (window.jsPlumb && appState.librariesLoaded.jsPlumb) {
                     console.log("Attempting render with jsPlumb...");
                     if (renderWithJSPlumb()) { // renderWithJSPlumb returns true on success attempt
                         console.log("jsPlumb rendering initiated.");
                         return; // Success
                     }
                     console.warn("jsPlumb rendering failed, using fallback.");
                } else {
                     console.log("jsPlumb library not available or not loaded.");
                }
                */

                // 4. Fallback to simple HTML structure
                console.log("All visual libraries failed or unavailable, using simple HTML fallback.");
                renderSimpleMindmapFallback();

            } catch (error) {
                console.error("Error during mind map rendering attempt:", error);
                renderSimpleMindmapFallback(`An error occurred during rendering: ${error.message}`);
            }
        }, 100); // Short delay
    }

    // Render with Mermaid using mermaid.run() API
    async function renderWithMermaidRun() {
        try {
            if (!window.mermaid) throw new Error("Mermaid library not loaded.");

            // Prepare container (keep existing logic)
            mindmapContainer.innerHTML = `
                <div class="mermaid mind-map-rendered mx-auto overflow-auto max-w-full p-4 bg-gray-800 rounded-lg border border-gray-700" style="min-height: 400px;">
                    ${escapeHtml(appState.mindMapSyntax) /* Render raw syntax for Mermaid */}
                </div>
                <div id="mermaid-controls" class="flex justify-center mt-4 space-x-2">
                    <button class="zoom-in btn-secondary btn-sm" title="Zoom In"><span class="material-icons-round text-sm">add</span></button>
                    <button class="zoom-out btn-secondary btn-sm" title="Zoom Out"><span class="material-icons-round text-sm">remove</span></button>
                    <button class="reset-view btn-secondary btn-sm" title="Reset View"><span class="material-icons-round text-sm">restart_alt</span></button>
                </div>
            `;
            const mermaidElement = mindmapContainer.querySelector('.mermaid');
            if (!mermaidElement) throw new Error("Mermaid container element not found after setting innerHTML.");

            // Use mermaid.run() - it's asynchronous
            console.log("Calling mermaid.run()..."); // Added log
            await mermaid.run({
                nodes: [mermaidElement] // Target the specific element
            });
            console.log("mermaid.run() completed."); // Added log

            // Check if SVG was actually rendered inside the target element
            const svg = mermaidElement.querySelector('svg');
            if (!svg) {
                throw new Error("Mermaid.run() completed but no SVG was generated. Check syntax or console for errors.");
            }
            console.log("SVG element found."); // Added log

            // Make SVG responsive and add controls (keep existing logic)
            svg.setAttribute('width', '100%');
            svg.style.maxWidth = '100%';
            setupSvgZoomControls(svg, document.getElementById('mermaid-controls'));

            // *** MODIFICATION START: Queue MathJax AFTER Mermaid SVG exists ***
            if (window.MathJax && appState.mindMapSyntax.includes('$')) {
                 console.log("Syntax contains '$', queueing MathJax for the mermaid element...");
                 try {
                      // Target the specific mermaid element that now contains the SVG
                      MathJax.Hub.Queue(["Typeset", MathJax.Hub, mermaidElement]);
                      console.log("MathJax typesetting queued successfully.");
                 } catch (mjError) {
                      console.error("Error queueing MathJax:", mjError);
                      // Don't fail the whole render, but log the error
                 }
            } else {
                 console.log("No '$' found in syntax or MathJax not loaded, skipping MathJax queue.");
            }
            // *** MODIFICATION END ***

            console.log("Mermaid diagram rendering pipeline finished.");
            return true; // Indicate success

        } catch (error) {
            console.error("Error executing Mermaid rendering with mermaid.run():", error);
            if (mindmapErrorDiv) {
                const errorContent = mindmapErrorDiv.querySelector('div');
                if (errorContent) errorContent.textContent = `Mermaid Error: ${error.message || error}`;
                mindmapErrorDiv.classList.remove('hidden');
            }
            // Also display error in main container for visibility
            mindmapContainer.innerHTML = `
                <div class="text-center p-6 text-red-400">
                    <span class="material-icons-round text-3xl mb-2">error</span>
                    <p>Error rendering Mermaid diagram:</p>
                    <p class="text-sm mt-1">${escapeHtml(error.message || error)}</p>
                    <details class="mt-2 text-xs text-gray-500 text-left bg-gray-700 p-2 rounded">
                        <summary>Show Raw Syntax</summary>
                        <pre class="mt-1 whitespace-pre-wrap break-all">${escapeHtml(appState.mindMapSyntax)}</pre>
                    </details>
                </div>`;
            return false; // Indicate failure
        }
    }


    // Helper for SVG Zoom Controls
    function setupSvgZoomControls(svgElement, controlsContainer) {
        if (!svgElement || !controlsContainer) return;

        let scale = 1;
        const zoomInBtn = controlsContainer.querySelector('.zoom-in');
        const zoomOutBtn = controlsContainer.querySelector('.zoom-out');
        const resetBtn = controlsContainer.querySelector('.reset-view');

        // Apply CSS class for smoother transitions
        svgElement.style.transition = 'transform 0.2s ease-out';
        svgElement.style.transformOrigin = 'center center'; // Center zoom

        const applyTransform = () => {
            svgElement.style.transform = `scale(${scale})`;
        };

        if (zoomInBtn) {
            zoomInBtn.onclick = () => {
                scale = Math.min(scale + 0.15, 3); // Max zoom 3x
                applyTransform();
            };
        }
        if (zoomOutBtn) {
            zoomOutBtn.onclick = () => {
                scale = Math.max(scale - 0.15, 0.3); // Min zoom 0.3x
                applyTransform();
            };
        }
        if (resetBtn) {
            resetBtn.onclick = () => {
                scale = 1;
                applyTransform();
            };
        }
        // Apply initial scale
        applyTransform();
    }

    // Render with Cytoscape
    function renderWithCytoscape() {
        try {
            if (!window.cytoscape) {
                 console.error("Cytoscape library not available.");
                 return false;
            }

            const { nodes, connections } = parseMermaidSyntax(appState.mindMapSyntax);
            if (!nodes || nodes.length === 0) {
                 console.warn("No nodes parsed for Cytoscape.");
                 return false;
            }

            // Create container with increased height
            mindmapContainer.innerHTML = `
                <div class="w-full h-[650px] bg-gray-800 rounded-lg border border-gray-700 relative mind-map-rendered"> <!-- Increased height -->
                    <div id="cytoscape-controls" class="absolute top-2 right-2 z-10 flex space-x-1">
                        <button class="zoom-in btn-icon btn-sm" title="Zoom In"><span class="material-icons-round text-sm">add</span></button>
                        <button class="zoom-out btn-icon btn-sm" title="Zoom Out"><span class="material-icons-round text-sm">remove</span></button>
                        <button class="reset-view btn-icon btn-sm" title="Reset View"><span class="material-icons-round text-sm">restart_alt</span></button>
                    </div>
                    <div id="cytoscape-canvas" class="w-full h-full"></div>
                </div>
            `;

            const cyElements = [];
            nodes.forEach(node => cyElements.push({ data: { id: node.id, label: node.text || node.id, type: node.type || 'default' } }));
            connections.forEach((conn, index) => cyElements.push({ data: { id: `edge-${index}`, source: conn.source, target: conn.target, label: conn.label || '' } }));

            const cy = window.cytoscape({
                container: document.getElementById('cytoscape-canvas'),
                elements: cyElements,
                style: [ // *** MODIFIED STYLES ***
                    { selector: 'node', style: {
                        'label': 'data(label)',
                        'text-valign': 'center',
                        'text-halign': 'center',
                        'background-color': '#4b5563',
                        'color': '#ffffff',
                        'text-wrap': 'wrap',
                        'text-max-width': '120px', // Increased max width for text
                        'font-size': '14px', // Increased font size
                        'padding': '12px', // Increased padding around text
                        'shape': 'round-rectangle',
                        'width': 'label', // Auto width based on label
                        'height': 'label' // Auto height based on label
                    }},
                    { selector: 'node[type="main"]', style: {
                        'background-color': '#3b82f6',
                        'font-weight': 'bold',
                        'font-size': '16px', // Larger font for main node
                         'padding': '15px'
                    }},
                    { selector: 'edge', style: {
                        'width': 1.5,
                        'line-color': '#6b7280',
                        'target-arrow-color': '#6b7280',
                        'target-arrow-shape': 'triangle',
                        'curve-style': 'bezier',
                        'arrow-scale': 0.8,
                        'label': 'data(label)', // Display edge labels if present
                        'color': '#9ca3af',
                        'font-size': '10px',
                        'text-background-color': '#1f2937', // Background for edge labels
                        'text-background-opacity': 0.7,
                        'text-background-padding': '2px'
                    }}
                ],
                 // Adjusted layout parameters for potentially better spacing
                layout: {
                     name: 'breadthfirst', // Or try 'cose', 'cola', 'dagre'
                     directed: true,
                     padding: 30, // Increased padding around graph
                     spacingFactor: 1.5, // Increased spacing between nodes
                     fit: true // Fit the graph to the viewport initially
                }
            });

            // Setup controls
            const controlsContainer = document.getElementById('cytoscape-controls');
            controlsContainer.querySelector('.zoom-in').onclick = () => cy.zoom(cy.zoom() * 1.2);
            controlsContainer.querySelector('.zoom-out').onclick = () => cy.zoom(cy.zoom() * 0.8);
            controlsContainer.querySelector('.reset-view').onclick = () => cy.fit(null, 30); // Fit with padding

            console.log("Cytoscape rendering initiated.");
            return true; // Indicate success

        } catch (error) {
            console.error("Cytoscape rendering error:", error);
            if (mindmapErrorDiv) {
                const errorContent = mindmapErrorDiv.querySelector('div');
                if (errorContent) errorContent.textContent = `Cytoscape Error: ${error.message}`;
                mindmapErrorDiv.classList.remove('hidden');
            }
            return false; // Indicate failure
        }
    }

    // Fallback renderer: Displays a simple HTML tree or raw syntax
    function renderSimpleMindmapFallback(errorMessage = "Could not render visual mind map.") {
        try {
            // Ensure container exists
            if (!mindmapContainer) return;
             console.log("Rendering simple mind map fallback..."); // Added log

            let contentHtml = '';
            const { nodes, connections } = parseMermaidSyntax(appState.mindMapSyntax);

            // Try to build a simple HTML list structure if parsing worked
            if (nodes && nodes.length > 0) {
                const nodeMap = {};
                const rootNodes = [];
                const childrenMap = {}; // Map parentId -> [childNode]

                nodes.forEach(node => {
                    nodeMap[node.id] = { ...node, text: node.text || node.id }; // Ensure text field exists
                    childrenMap[node.id] = []; // Initialize children list
                });

                const childIds = new Set();
                connections.forEach(conn => {
                    if (nodeMap[conn.source] && nodeMap[conn.target]) {
                        childrenMap[conn.source].push(nodeMap[conn.target]);
                        childIds.add(conn.target);
                    }
                });

                // Find root nodes
                nodes.forEach(node => {
                    if (!childIds.has(node.id)) {
                        rootNodes.push(nodeMap[node.id]);
                    }
                });
                if (rootNodes.length === 0 && nodes.length > 0) {
                    rootNodes.push(nodeMap[nodes[0].id]);
                }

                // Recursive function to build HTML list structure *without* rendering content yet
                const buildListStructure = (nodeList, level = 0) => {
                    if (!nodeList || nodeList.length === 0 || level > 10) return '';
                    let listHtml = `<ul class="list-none ml-${level * 4} space-y-1.5">`;
                    nodeList.forEach(node => {
                         const nodeClass = node.type === 'main' ? 'font-semibold text-blue-300' : 'text-gray-300';
                         // Add data attributes to store node text and track children
                         listHtml += `<li class="${nodeClass}" data-node-id="${node.id}" data-node-text="${escapeHtml(node.text)}">
                                        <span class="mr-2 text-gray-500">•</span><span class="node-label-placeholder"></span>`; // Placeholder for label
                         // Recursively add children structure
                         listHtml += buildListStructure(childrenMap[node.id], level + 1);
                         listHtml += '</li>';
                    });
                    listHtml += '</ul>';
                    return listHtml;
                };

                contentHtml = buildListStructure(rootNodes);

                 // Display the fallback content structure
                 mindmapContainer.innerHTML = `
                     <div class="p-4 bg-gray-800 rounded-lg border border-dashed border-yellow-600">
                         <p class="text-yellow-400 text-sm mb-3"><span class="material-icons-round text-sm mr-1 align-bottom">warning</span>${escapeHtml(errorMessage)} Using simplified view.</p>
                         <div id="fallback-mindmap-list" class="max-h-[600px] overflow-auto">
                             ${contentHtml}
                         </div>
                     </div>
                 `;

                 // --- New Step: Iterate and Render Content AFTER structure is in DOM ---
                 const listContainer = document.getElementById('fallback-mindmap-list');
                 if (listContainer) {
                     listContainer.querySelectorAll('li[data-node-id]').forEach(liElement => {
                          const nodeText = liElement.dataset.nodeText; // Get raw text
                          const labelPlaceholder = liElement.querySelector('.node-label-placeholder');
                          if (labelPlaceholder && nodeText) {
                              // Use renderFormattedContent on the placeholder span
                              renderFormattedContent(labelPlaceholder, nodeText);
                          }
                     });

                     // Explicitly queue MathJax for the entire list container after processing all nodes
                     if (window.MathJax) {
                         console.log("Queueing MathJax for fallback list container.");
                         try {
                             MathJax.Hub.Queue(["Typeset", MathJax.Hub, listContainer]);
                         } catch (mjError) {
                             console.error("Error queueing MathJax for fallback list:", mjError);
                         }
                     }
                 } else {
                      console.error("Fallback list container not found.");
                 }


            } else {
                // If parsing failed, show raw syntax
                contentHtml = `<pre class="text-sm whitespace-pre-wrap">${escapeHtml(appState.mindMapSyntax)}</pre>`;
                errorMessage += " Displaying raw structure.";
                 // Display the error message and raw syntax
                 mindmapContainer.innerHTML = `
                     <div class="p-4 bg-gray-800 rounded-lg border border-dashed border-yellow-600">
                         <p class="text-yellow-400 text-sm mb-3"><span class="material-icons-round text-sm mr-1 align-bottom">warning</span>${escapeHtml(errorMessage)}</p>
                         <div class="max-h-[600px] overflow-auto">
                             ${contentHtml}
                         </div>
                     </div>
                 `;
            }


        } catch (error) {
            console.error("Error creating simple fallback mind map:", error);
            // Ultimate fallback: just show the raw syntax and an error
            if (mindmapContainer) {
                mindmapContainer.innerHTML = `
                    <div class="p-4 bg-red-900 text-red-200 rounded-lg border border-red-700">
                        <p class="mb-2"><span class="material-icons-round mr-1">error</span>Failed to display mind map. Error: ${escapeHtml(error.message)}</p>
                        <p class="text-sm mb-2">Raw Mind Map Data:</p>
                        <pre class="text-xs whitespace-pre-wrap bg-gray-800 p-2 rounded">${escapeHtml(appState.mindMapSyntax || "No data available")}</pre>
                    </div>
                `;
            }
        }
    }

    // Helper function to parse mermaid syntax into nodes and connections (Improved)
    function parseMermaidSyntax(syntax) {
        const nodes = [];
        const connections = [];
        const nodeMap = {}; // Use Map for easier checking

        if (!syntax || typeof syntax !== 'string') {
            console.warn("Invalid syntax provided to parseMermaidSyntax");
            return { nodes: [{ id: 'error', text: 'Invalid Syntax', type: 'main' }], connections: [] };
        }
        console.log("Parsing Mermaid Syntax..."); // Added log

        // Remove comments and normalize lines
        const lines = syntax
            .split('\n')
            .map(line => line.replace(/%%.*/, '').trim()) // Remove comments
            .filter(line => line && !line.match(/^\s*(graph|flowchart)/i)); // Filter empty lines and graph declaration

        // Regex V2: More robust for different delimiters and quotes, trying to capture everything inside
        // Handles A["Label with $x^2$"], B(Label), C{Label}, D((Label)) etc.
        // It prioritizes quoted labels first.
        const nodeDefRegex = /^([a-zA-Z0-9_]+)(?:\["(.*?)"\]|\[(.*?)\]|\(""(.*?)""\)|\((.*?)\)|{{"(.*?)"}}|{{(.*?)}}|\(\("(.*?)"\)\)|\(\((.*?)\)\)|>"(.*?)"<|>(.*?)<)/;
        const connectionRegex = /^([a-zA-Z0-9_]+)\s*(?:<?(?:--|==|-\.-)\s*(?:\|([^|]+)\|)?\s*(?:--|==|->)\s*)?([a-zA-Z0-9_]+)/; // Simplified connection slightly, focus on IDs and optional label

        // --- First Pass: Node Definitions ---
        lines.forEach(line => {
            const nodeMatch = line.match(nodeDefRegex);
            if (nodeMatch) {
                const id = nodeMatch[1];
                // Find the first captured group that is not undefined (this is the label)
                // Start searching from index 2 onwards.
                let text = nodeMatch.slice(2).find(group => group !== undefined);
                // If no specific label found, default to the ID itself
                if (text === undefined) {
                    text = id;
                } else {
                    text = text.trim(); // Trim whitespace from the captured label
                }

                console.log(`Parsed Node Def: ID=${id}, Text=${text}`); // Added log

                if (!nodeMap[id]) {
                    const newNode = { id, text: text, type: 'default' };
                    nodes.push(newNode);
                    nodeMap[id] = newNode;
                } else {
                    // Update text if node was implicitly created earlier
                    nodeMap[id].text = text;
                }
            }
        });

        // --- Second Pass: Connections & Implicit Nodes ---
        lines.forEach(line => {
            // Skip lines that definitely define nodes we already processed
            if (nodeDefRegex.test(line)) return;

            const connMatch = line.match(connectionRegex);
            if (connMatch) {
                const sourceId = connMatch[1];
                const label = connMatch[2]?.trim() || ''; // Get optional label
                const targetId = connMatch[3];

                console.log(`Parsed Connection: ${sourceId} --${label ? '['+label+']' : ''}--> ${targetId}`); // Added log

                // Ensure source node exists implicitly
                if (!nodeMap[sourceId]) {
                    console.log(`Implicit Node: ${sourceId}`); // Added log
                    const newNode = { id: sourceId, text: sourceId, type: 'default' };
                    nodes.push(newNode);
                    nodeMap[sourceId] = newNode;
                }
                // Ensure target node exists implicitly
                if (!nodeMap[targetId]) {
                     console.log(`Implicit Node: ${targetId}`); // Added log
                    const newNode = { id: targetId, text: targetId, type: 'default' };
                    nodes.push(newNode);
                    nodeMap[targetId] = newNode;
                }

                connections.push({ source: sourceId, target: targetId, label: label });
            }
        });


        // If no nodes parsed, return error node
        if (nodes.length === 0) {
            console.warn("No nodes could be parsed from syntax.");
            return { nodes: [{ id: 'parse_fail', text: 'Parsing Failed', type: 'main' }], connections: [] };
        }

        // Designate root node(s) (same logic)
        const childIds = new Set(connections.map(c => c.target));
        let rootFound = false;
        nodes.forEach(node => {
            if (!childIds.has(node.id)) {
                node.type = 'main';
                rootFound = true;
            }
        });
        if (!rootFound && nodes.length > 0) {
            nodes[0].type = 'main';
        }

        console.log("Parsing finished. Nodes found:", nodes.length, "Connections found:", connections.length); // Added log
        return { nodes, connections };
    }


    // --- Chat Handling ---
    async function handleSendChatMessage() {
        const message = chatInput.value.trim();
        if (!message) return;
        if (!appState.notes && !appState.originalText) {
            alert("Please process content first to enable chat.");
            return;
        }

        // Add user message to UI immediately
        appendChatMessage('user', message);
        const currentMessage = message;
        chatInput.value = '';
        chatInput.style.height = 'auto'; // Reset height
        setLoading(true, 'Getting response...');

        // Add user message to state history *before* sending API call
        appState.chatHistory.push({ role: 'user', parts: [currentMessage] });

        try {
            // Send recent history + new message
            const response = await apiCall('/api/chat', {
                method: 'POST',
                body: JSON.stringify({
                    notes: appState.notes,
                    original_text: appState.originalText,
                    // Send only the last few turns to keep payload reasonable
                    history: appState.chatHistory.slice(-10),
                    message: currentMessage,
                    web_search_enabled: appState.webSearchEnabled
                })
            });

            if (response.status === "success" && response.response) {
                // Add assistant response to UI
                appendChatMessage('assistant', response.response);
                // Update state history with the returned history (which includes the latest exchange)
                // Ensure the returned history is valid before updating
                if (Array.isArray(response.history)) {
                    appState.chatHistory = response.history;
                } else {
                     console.warn("Received invalid chat history from backend, appending manually.");
                     // Manually append assistant response if history update failed
                     appState.chatHistory.push({ role: 'model', parts: [response.response] });
                }

            } else {
                throw new Error(response.error || "Failed to get chat response");
            }

        } catch (error) {
            console.error("Error sending chat message:", error);
            appendChatMessage('error', `Error: ${error.message}`);
            // Remove the last user message from history if API call failed
            appState.chatHistory.pop();
        } finally {
            setLoading(false);
            chatInput.focus();
        }
    }


    function appendChatMessage(role, text) {
        // Clear initial placeholder if present
        if (chatHistoryDiv.querySelector('.text-center')) {
            chatHistoryDiv.innerHTML = '';
        }

        const messageContainer = document.createElement('div');
        messageContainer.className = 'mb-4';

        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-bubble ${role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'assistant bg-red-900 text-red-100'}`; // Style errors

        if (role === 'user') {
            messageContainer.className = 'mb-4 flex justify-end';
            // User messages are plain text, escape them
            messageDiv.innerHTML = `<p>${escapeHtml(text)}</p>`;
        } else if (role === 'assistant') {
            messageContainer.className = 'mb-4 flex justify-start';
            // Assistant messages can contain Markdown/LaTeX/Mermaid, use renderFormattedContent
            renderFormattedContent(messageDiv, text);
        } else { // Error
            messageContainer.className = 'mb-4 flex justify-center';
            messageDiv.innerHTML = `
                <div class="flex items-start">
                    <span class="material-icons-round mr-2 text-red-300">error_outline</span>
                    <p>${escapeHtml(text)}</p>
                </div>
            `;
        }

        messageContainer.appendChild(messageDiv);
        chatHistoryDiv.appendChild(messageContainer);
        // Ensure scroll to bottom happens after content is potentially rendered
        setTimeout(() => {
             chatHistoryDiv.scrollTop = chatHistoryDiv.scrollHeight;
        }, 50);
    }


    // --- Download Handler ---
    function handleDownloadNotes() {
        const format = downloadFormatSelect.value;
        const originalText = downloadNotesBtn.innerHTML; // Store original button text

        // Function to set button state
        const setButtonState = (text, className = '', disable = false) => {
            downloadNotesBtn.innerHTML = text;
            downloadNotesBtn.disabled = disable;
            // Reset classes before adding new one
            downloadNotesBtn.classList.remove('bg-green-600', 'bg-red-600');
            if (className) {
                downloadNotesBtn.classList.add(className);
            }
        };

        // Handle PDF case separately as it uses window.print()
        if (format === 'pdf') {
            setButtonState('<span class="material-icons-round mr-1 animate-spin">autorenew</span> Preparing PDF...', '', true);
            console.log("Preparing for PDF print...");

            // Give dynamic renderers (MathJax, Mermaid) time to finish.
            // A more robust solution would involve callbacks or promises from these libraries.
            const renderDelay = 1500; // Adjust delay as needed (milliseconds)
            setTimeout(() => {
                try {
                    console.log("Triggering window.print()...");
                    window.print(); // Trigger the browser's print dialog

                    // Reset button shortly after print dialog likely appears
                    setButtonState(originalText, '', false);
                    // Save preference
                    appState.preferences.lastUsedDownloadFormat = format;
                    savePreferences();

                } catch (error) {
                    console.error("Error triggering print dialog:", error);
                    setButtonState('<span class="material-icons-round mr-1">error</span> Print Failed', 'bg-red-600', false);
                    // Reset after showing error
                    setTimeout(() => setButtonState(originalText, '', false), 3000);
                }
            }, renderDelay);
            return; // Exit the function for PDF format
        }

        // Handle other formats (MD, TXT, HTML)
        setButtonState('<span class="material-icons-round mr-1 animate-spin">autorenew</span> Preparing...', '', true);

        // Use setTimeout to allow UI to update before potentially heavy processing
        setTimeout(() => {
            let content = '';
            let mimeType = '';
            let fileName = `notes_${appState.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'export'}`;

            try {
                switch (format) {
                    case 'txt':
                        content = convertHtmlToText(notesContent.innerHTML);
                        mimeType = 'text/plain';
                        fileName += '.txt';
                        break;

                    case 'md':
                        content = appState.notes || ''; // Use raw Markdown
                        mimeType = 'text/markdown';
                        fileName += '.md';
                        break;

                    case 'html':
                         const basicCSS = `
                             :root {
                               --bg-color: #121212;
                               --text-color: #e0e0e0;
                               --border-color: #444;
                               --code-bg: #1a202c;
                               --heading-color: #eee;
                               --link-color: #63b3ed;
                             }
                             body {
                               background-color: var(--bg-color);
                               color: var(--text-color);
                               font-family: 'Inter', -apple-system, sans-serif;
                               line-height: 1.6;
                               padding: 2rem;
                               max-width: 1000px;
                               margin: 0 auto;
                             }
                             .title { color: var(--heading-color); font-size: 2rem; margin-bottom: 2rem; }
                             .prose h1, .prose h2, .prose h3 { color: var(--heading-color); border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem; margin-top: 2rem; }
                             .prose pre { background-color: var(--code-bg); padding: 1rem; border-radius: 5px; overflow-x: auto; }
                             .prose code { background-color: var(--code-bg); padding: 0.2em 0.4em; border-radius: 3px; }
                             .prose blockquote { border-left: 3px solid var(--border-color); margin-left: 0; padding-left: 1rem; color: var(--text-color); }
                             .prose a { color: var(--link-color); }
                             .source-link { color: #a0aec0; text-decoration: none; border-bottom: 1px dashed #718096; }
                             /* Print styles */
                             @media print {
                               body {
                                 background-color: white;
                                 color: black;
                               }
                               .prose h1, .prose h2, .prose h3 {
                                 color: black;
                                 border-bottom-color: #ccc;
                               }
                               .prose a, .source-link {
                                 color: #0066cc;
                               }
                               .prose pre, .prose code {
                                 background-color: #f5f5f5;
                                 border: 1px solid #ddd;
                                 color: black;
                               }
                             }
                         `;
                         const tocScript = `
                             document.addEventListener('DOMContentLoaded', function() {
                                 const content = document.querySelector('.prose');
                                 const headings = content.querySelectorAll('h1, h2, h3');
                                 const toc = document.getElementById('table-of-contents');
                                 if (headings.length > 3 && toc) {
                                     const tocList = document.createElement('ul');
                                     tocList.className = 'toc-list';
                                     headings.forEach((heading, index) => {
                                         if (!heading.id) heading.id = 'heading-' + index;
                                         const item = document.createElement('li');
                                         item.className = 'toc-item toc-' + heading.tagName.toLowerCase();
                                         const link = document.createElement('a');
                                         link.href = '#' + heading.id;
                                         link.textContent = heading.textContent;
                                         item.appendChild(link);
                                         tocList.appendChild(item);
                                     });
                                     toc.appendChild(tocList);
                                     toc.style.display = 'block';
                                 } else if (toc) {
                                     toc.style.display = 'none';
                                 }
                             });
                         `;
                         const renderedNotesHtml = notesContent.innerHTML;
                         content = `
 <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
 <title>${escapeHtml(appState.title)} - Study Notes</title><style>${basicCSS}#table-of-contents{margin:2rem 0;padding:1rem;background-color:rgba(255,255,255,0.05);border-radius:8px}.toc-list{list-style-type:none;padding-left:0}.toc-h1{font-weight:bold;margin-top:.5rem}.toc-h2{padding-left:1.5rem;margin:.25rem 0}.toc-h3{padding-left:3rem;margin:.25rem 0;font-size:.9em}.toc-item a{color:var(--text-color);text-decoration:none;transition:color .2s}.toc-item a:hover{color:var(--link-color)}.print-button{position:fixed;bottom:2rem;right:2rem;background-color:var(--link-color);color:#fff;border:none;border-radius:50%;width:50px;height:50px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 5px rgba(0,0,0,.2);z-index:100}.print-button svg{width:24px;height:24px}@media print{.print-button{display:none}}</style>
 <script src="https://cdnjs.cloudflare.com/ajax/libs/mathjax/2.7.9/MathJax.js?config=TeX-MML-AM_CHTML"></script><script type="text/x-mathjax-config">MathJax.Hub.Config({tex2jax:{inlineMath:[['$','$'],['\\(','\\)']],displayMath:[['$$','$$'],['\\[','\\]']]}});</script>
 <script>${tocScript}</script></head><body><h1 class="title">${escapeHtml(appState.title)}</h1><div id="table-of-contents"><h2>Table of Contents</h2></div><div class="prose">${renderedNotesHtml}</div>
 <footer style="margin-top:2rem;padding-top:1rem;border-top:1px solid var(--border-color);color:#a0aec0;font-size:.9rem;">Generated by AI Study Assistant</footer>
 <button class="print-button" onclick="window.print()" title="Print or Save as PDF"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg></button></body></html>`;
                         mimeType = 'text/html';
                         fileName += '.html';
                        break;

                    default:
                        console.error("Unsupported download format:", format);
                        throw new Error("Unsupported download format");
                }

                // Create download
                const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                // Save preference
                appState.preferences.lastUsedDownloadFormat = format;
                savePreferences();

                setButtonState('<span class="material-icons-round mr-1">check</span> Downloaded', 'bg-green-600', false);
                setTimeout(() => setButtonState(originalText, '', false), 2000);

            } catch (error) {
                console.error("Download error:", error);
                setButtonState('<span class="material-icons-round mr-1">error</span> Failed', 'bg-red-600', false);
                setTimeout(() => setButtonState(originalText, '', false), 3000);
            }
        }, 100); // Short delay for non-PDF formats
    }

    // Basic HTML to Text conversion
    function convertHtmlToText(html) {
        let tempDiv = document.createElement('div');
        // Replace breaks and paragraphs with newlines
        html = html.replace(/<br\s*\/?>/gi, '\n');
        html = html.replace(/<\/p>/gi, '\n\n');
        html = html.replace(/<\/h[1-6]>/gi, '\n\n');
        html = html.replace(/<\/li>/gi, '\n');
        html = html.replace(/<\/div>/gi, '\n'); // Handle divs as potential line breaks

        tempDiv.innerHTML = html;

        // Clean up the text
        let text = tempDiv.textContent || tempDiv.innerText || "";
        // Remove excessive whitespace and normalize line endings
        text = text.replace(/\r\n/g, '\n'); // Normalize Windows line endings
        text = text.replace(/[ \t]*\n[ \t]*/g, '\n'); // Trim whitespace around newlines
        text = text.replace(/\n{3,}/g, '\n\n'); // Collapse multiple blank lines
        text = text.trim(); // Trim leading/trailing whitespace
        return text;
    }

});