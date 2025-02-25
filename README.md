# Study Assistant

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Description

Study Assistant is an AI-powered web application designed to help **geeks and students** learn and retain information more effectively.  It leverages the power of large language models to transform various content sources – YouTube videos, website URLs, and uploaded files – into comprehensive study materials.  By generating detailed notes, interactive quizzes, and handy flashcards, Study Assistant streamlines the learning process and makes studying more engaging and efficient.

## ✨ Key Features

*   **Multi-Source Content Processing:** Input content from YouTube URLs, website links, and upload various file types (PDF, audio, video) to consolidate your study material in one place.
*   **AI-Powered Note Generation:**  Automatically create structured and detailed study notes from your content sources, highlighting key concepts and explanations.
*   **Web Search Enhanced Notes:**  Optionally enable web search during content processing to enrich study notes with contextually relevant information from the internet, improving comprehensiveness and accuracy.
*   **Interactive Quiz Generation:**  Generate quizzes tailored to your study content, helping you test your understanding and identify areas for improvement. Quizzes are designed with explanations for correct answers, common misconceptions, and related concepts for deeper learning.
*   **Flashcard Creation for Memorization:**  Turn key information from your study notes into flashcards for effective memorization and spaced repetition learning techniques.
*   **Chat with Your Study Material:**  Engage in a conversational chat interface powered by AI to ask questions and get clarifications directly related to your study notes.
*   **Adaptive Quiz Difficulty:** The application attempts to determine the appropriate quiz difficulty based on your past performance, aiming to challenge you effectively.
*   **User-Friendly Web Interface:** Access all features through a clean and intuitive web interface, making studying accessible from any device with a browser.

## ⚠️ Limitations

*   **No Visual Data Handling:** Study Assistant primarily focuses on text-based content. It does not extract or provide visual data or diagrams from YouTube videos or other sources within the generated notes.
*   **Temporary File Storage:** Uploaded files are processed temporarily during content extraction and may not be permanently stored.
*   **Dependency on External APIs:**  The application relies on the Google Gemini API and Google Custom Search API, which require API keys and may have usage limits.

## 🚀 Getting Started

### Prerequisites

*   **Python:**  Make sure you have Python **3.11.9** installed on your system.
*   **Pip:** Python package installer (should come with Python installations).
*   **Google Cloud Account:** You will need a Google Cloud account to obtain the necessary API keys.
*   **Google Custom Search Engine:** You'll need to set up a Custom Search Engine to use the web search feature.

### Installation

1.  **Clone the repository** (If you have a repository, replace `[repository-url]` with your actual repository URL. If not, adjust this step accordingly):

    ```bash
    git clone [repository-url]
    cd [study-assistant-directory]
    ```

2.  **Create a virtual environment** (recommended):

    ```bash
    python -m venv venv
    ```

3.  **Activate the virtual environment:**

    *   **On Windows:**

        ```bash
        venv\Scripts\activate
        ```

    *   **On macOS and Linux:**

        ```bash
        source venv/bin/activate
        ```

4.  **Install Python dependencies:**

    ```bash
    pip install -r requirements.txt
    ```

    Create a `requirements.txt` file in the root directory of your project with the following content:

    ```txt
    Flask==3.1.0
    youtube-transcript-api==0.6.3
    google-generativeai==0.8.4
    beautifulsoup4==4.12.3
    requests==2.32.3
    ```

5.  **Set up Environment Variables:**

    You need to set the following environment variables.  It's recommended to set these in your shell's configuration file (e.g., `.bashrc`, `.zshrc`, `.bash_profile`) or using a tool like `direnv`.

    *   **`GOOGLE_API_KEY`**: Your API key for accessing Google services, including the Gemini API and Google Custom Search API.

        *   **How to obtain a Google API Key:**
            1.  Go to the [Google Cloud Console](https://console.cloud.google.com/).
            2.  Create or select a project.
            3.  Enable the **Gemini API** and **Custom Search JSON API** for your project.
            4.  Go to "APIs & Services" > "Credentials".
            5.  Click "Create credentials" > "API key".
            6.  Copy the generated API key.

    *   **`SEARCH_ENGINE_ID`**:  Your Custom Search Engine ID.

        *   **How to obtain a Search Engine ID:**
            1.  Go to [Google Custom Search Engine](https://cse.google.com/cse/all).
            2.  Create or select a search engine.
            3.  Go to "Setup" > "Basics".
            4.  Copy the "Search engine ID".

    **Example of setting environment variables in `.bashrc` or `.zshrc`:**

    ```bash
    export GOOGLE_API_KEY="YOUR_GOOGLE_API_KEY"
    export SEARCH_ENGINE_ID="YOUR_SEARCH_ENGINE_ID"
    ```

    **Remember to replace `"YOUR_GOOGLE_API_KEY"` and `"YOUR_SEARCH_ENGINE_ID"` with your actual API key and Search Engine ID.** After editing your shell configuration file, you might need to run `source ~/.bashrc` or `source ~/.zshrc` to apply the changes to your current shell session.

6.  **Initialize the Database:**

    The application uses an SQLite database (`study_assistant.db`). The database is automatically initialized when you run the application for the first time. No manual database creation is needed.

### Running the Application

1.  **Navigate to the project directory** in your terminal if you are not already there.
2.  **Ensure your virtual environment is activated.**
3.  **Run the Flask application:**

    ```bash
    python app.py
    ```

4.  **Access the Study Assistant in your browser:**

    Open your web browser and go to [http://127.0.0.1:5000/](http://127.0.0.1:5000/) or [http://localhost:5000/](http://localhost:5000/).

## ⚙️ Usage

1.  **Input Content:** On the homepage, you have several options to input study content:
    *   **Content URLs:** Enter YouTube video URLs or website URLs (one per line) in the "Content URLs" text area.
    *   **File Uploads:** Drag and drop files (PDF, MP3, WAV, MP4, MOV) into the designated "Drag & drop files here" area, or click "Browse Files" to select files from your computer.  The maximum file size is 100MB.
    *   **Enable Web Search:**  Toggle the "Enable Web Search" checkbox to include relevant web search results when generating study notes.

2.  **Process Content:** Click the "Process Content" button. The application will process the provided content and generate study notes. A progress bar will be displayed during processing.

3.  **View Content Information:** After processing is complete, the "Content Display Section" will appear, showing:
    *   **Title:** The generated title for your combined content.
    *   **Content ID:** A unique ID for the processed content (useful for referencing later).
    *   **"Show Notes" Button:** Click to view the generated study notes in Markdown format.
    *   **"Generate Quiz" Button:** Click to create a quiz based on the study notes.
    *   **"Generate Flashcards" Button:** Click to generate flashcards for memorization.
    *   **"Chat with Content" Section:** Use this to ask questions about the study material.

4.  **Explore Study Notes:** Click "View Notes" to open the "Notes Section." The notes are displayed in a readable Markdown format. You can close the notes by clicking the "×" button.

5.  **Take Quizzes:** Click "Generate Quiz" to open the "Quiz Section." Answer the multiple-choice questions.
    *   **Submit Quiz:** Click "Submit Answers" to check your answers and receive feedback, including explanations, common misconceptions, and related concepts for each question. Your quiz performance is recorded to potentially adapt future quiz difficulty.
    *   **Generate More Questions:** Click "Generate More Questions" to get a new set of quiz questions on the same content.

6.  **Use Flashcards:** Click "Generate Flashcards" to open the "Flashcards Section."
    *   **Review Flashcards:** Use the "Next" and "Previous" buttons to navigate through the flashcards.
    *   **Flip Card:** Click "Flip" to reveal the answer on the back of the flashcard.
    *   **Generate More Flashcards:** Click "Generate More Flashcards" to add more flashcards to the current set.

7.  **Chat with Content:** In the "Chat with Content" section:
    *   **Type your question** in the "Ask a question..." input field.
    *   **Click "Send"** or press Enter to send your message.
    *   The AI assistant will respond with answers related to your study notes. The chat history is preserved for ongoing conversation.

### Example Workflow

Imagine you want to study a YouTube video about "Quantum Physics":

1.  **Copy the YouTube URL** of the video.
2.  **Paste the URL** into the "Content URLs" text area on the Study Assistant homepage.
3.  **Ensure "Web Search" is enabled** (checkbox checked) if you want to enhance notes with web context.
4.  **Click "Process Content".**
5.  **Once processed, click "Show Notes"** to review the AI-generated study notes on Quantum Physics.
6.  **Click "Generate Quiz"** to test your knowledge with a quiz on the topic.
7.  **Answer the quiz questions and submit** to get feedback.
8.  **If you need to memorize key terms, click "Generate Flashcards"** and review the flashcards.
9.  **If you have specific questions about Quantum Physics, use the "Chat with Content"** feature to ask the AI assistant.

### Screenshots

You can find example screenshots of the application in the `examples/screenshots/` folder.

*   [Screenshot of the Content Upload Section](examples/screenshots/upload-section.png)
*   [Screenshot of Study Notes](examples/screenshots/study-notes.png)
*   [Screenshot of a Quiz](examples/screenshots/quiz-example.png)
*   [Screenshot of Flashcards](examples/screenshots/flashcards-example.png)
*   [Screenshot of Chat Interface](examples/screenshots/chat-interface.png)

**(Remember to create these example screenshots and place them in the `examples/screenshots/` folder and update the links above accordingly. If you are using GIFs, mention them and update paths.)**

## 📜 License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for more details.
