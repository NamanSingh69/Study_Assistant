from flask import Flask, request, jsonify, render_template, session
import os
from youtube_transcript_api import YouTubeTranscriptApi
import google.generativeai as genai
import json
import uuid
from datetime import datetime
from werkzeug.utils import secure_filename
import sqlite3
import requests
import time
from bs4 import BeautifulSoup

# --- Basic App Configuration ---
def init_app():
    app = Flask(__name__)
    app.secret_key = os.urandom(24)
    app.config['UPLOAD_FOLDER'] = 'uploads/'
    app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100 MB max file size
    app.config['DATABASE'] = 'study_assistant.db'
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    return app

app = init_app()

# --- API Configuration ---
def configure_api():
    """Configure Gemini API and ensure environment variables are set."""
    GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")
    SEARCH_ENGINE_ID = os.environ.get("SEARCH_ENGINE_ID")
    
    if not GOOGLE_API_KEY:
        raise ValueError("The GOOGLE_API_KEY environment variable is not set.")
    if not SEARCH_ENGINE_ID:
        raise ValueError("The SEARCH_ENGINE_ID environment variable is not set.")
    
    genai.configure(api_key=GOOGLE_API_KEY)
    model = genai.GenerativeModel('gemini-2.0-flash-thinking-exp-01-21')
    return model,genai 

model, genai = configure_api() 

def upload_to_gemini(file_path, mime_type):
    """Uploads file to Gemini and returns processed File object"""
    try:
        file = genai.upload_file(
            path=file_path,
            mime_type=mime_type,
            resumable=True
        )
        while file.state.name == 'PROCESSING':
            time.sleep(5)
            file = genai.get_file(file.name)
        if file.state.name != 'ACTIVE':
            raise ValueError(f"File processing failed: {file.state}")
        return file
    except Exception as e:
        raise RuntimeError(f"Gemini upload failed: {str(e)}")

# --- Database Initialization ---
def get_db_connection():
    """Establish a connection to the SQLite database."""
    conn = sqlite3.connect(app.config['DATABASE'])
    conn.row_factory = sqlite3.Row  # Access columns by name
    return conn

def init_db():
    """Initialize the database with necessary tables and columns."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Create tables if they don't exist
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS content (
            id TEXT PRIMARY KEY,
            title TEXT,
            source TEXT,
            content_type TEXT,
            original_text TEXT,
            notes TEXT,
            created_at TIMESTAMP,
            web_search_enabled INTEGER DEFAULT 1
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS quizzes (
            id TEXT PRIMARY KEY,
            content_id TEXT,
            questions TEXT,
            bloom_level TEXT,
            FOREIGN KEY (content_id) REFERENCES content (id)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS flashcards (
            id TEXT PRIMARY KEY,
            content_id TEXT,
            cards TEXT,
            FOREIGN KEY (content_id) REFERENCES content (id)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS chat_history (
            id TEXT PRIMARY KEY,
            content_id TEXT,
            history TEXT,
            FOREIGN KEY (content_id) REFERENCES content (id)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_performance (
            id TEXT PRIMARY KEY,
            content_id TEXT,
            quiz_id TEXT,
            bloom_level TEXT,
            correct_answers INTEGER,
            total_questions INTEGER,
            FOREIGN KEY (content_id) REFERENCES content (id),
            FOREIGN KEY (quiz_id) REFERENCES quizzes (id)
        )
    ''')
    
    try:
        cursor.execute("ALTER TABLE content ADD COLUMN original_text TEXT")
    except sqlite3.OperationalError:
        pass  # Column already exists

    try:
        cursor.execute("ALTER TABLE content ADD COLUMN web_search_enabled INTEGER DEFAULT 1")
    except sqlite3.OperationalError:
        pass  # Column already exists
    
    conn.commit()
    conn.close()

# --- Web Search Helper Functions ---
def search_web(query, num_results=5):
    """Search the web using Google Custom Search JSON API."""
    url = "https://www.googleapis.com/customsearch/v1"
    params = {
        "key": os.environ.get("GOOGLE_API_KEY"),
        "cx": os.environ.get("SEARCH_ENGINE_ID"),
        "q": query,
        "num": num_results,
    }
    try:
        response = requests.get(url, params=params)
        response.raise_for_status()
        results = response.json()
        return [item['link'] for item in results.get('items', [])]
    except requests.exceptions.RequestException as e:
        print(f"Search error: {str(e)}")
        return []

def fetch_page_content(url):
    """Fetch and extract text content from a webpage."""
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
        response = requests.get(url, headers=headers, timeout=15)
        soup = BeautifulSoup(response.content, 'html.parser')
        for element in soup(['script', 'style', 'nav', 'footer', 'header', 'form']):
            element.decompose()
        main_content = soup.find('article') or soup.find('main') or soup.body
        paragraphs = main_content.find_all(['p', 'h1', 'h2', 'h3', 'ul']) if main_content else []
        text = '\n'.join([p.get_text().strip() for p in paragraphs if p.get_text().strip()])
        return text[:10000]  # Limit to 10k characters
    except Exception as e:
        print(f"Error fetching {url}: {str(e)}")
        return ""

def generate_search_queries(content_text, num_queries=3):
    """Generate relevant search queries using Gemini."""
    prompt = f"""
    Based on the following content, generate {num_queries} relevant search queries to find additional information that could enhance understanding of the topic.
    Return the queries as a JSON array of strings, for example: ["query1", "query2", "query3"].
    Ensure the response is a valid JSON array.

    CONTENT:
    {content_text}
    """
    try:
        response = model.generate_content(prompt)
        if not response.candidates:
            print("No candidates in search query response")
            return []
        candidate = response.candidates[0]
        if candidate.finish_reason != 1:  # "STOP" means successful completion
            print(f"Search query generation incomplete with finish_reason: {candidate.finish_reason}")
            return []
        text = candidate.content.parts[0].text
        if text.startswith("```json") and text.endswith("```"):
            text = text[7:-3].strip()
        try:
            queries = json.loads(text)
            if isinstance(queries, list) and all(isinstance(q, str) for q in queries):
                return queries
            else:
                print(f"Invalid query format: {text}")
                return []
        except json.JSONDecodeError as e:
            print(f"Error parsing search queries: {text}, Error: {str(e)}")
            return []
    except Exception as e:
        print(f"Error generating search queries: {str(e)}")
        return []

# --- Content Processing Functions ---
def extract_video_id(url):
    """Extract YouTube video ID from URL."""
    if 'youtu.be' in url:
        return url.split('/')[-1]
    elif 'youtube.com/watch' in url:
        from urllib.parse import parse_qs, urlparse
        return parse_qs(urlparse(url).query)['v'][0]
    else:
        raise ValueError("Invalid YouTube URL")

def extract_from_youtube(url):
    """Extract content and title from YouTube video."""
    try:
        video_id = extract_video_id(url)
        transcript = YouTubeTranscriptApi.get_transcript(video_id)
        full_text = " ".join([entry['text'] for entry in transcript]).replace("\n", " ").strip()
        video_url = f"https://www.youtube.com/watch?v={video_id}"
        response = requests.get(video_url)
        soup = BeautifulSoup(response.content, 'html.parser')
        title = soup.find('title').text.replace(" - YouTube", "").strip()
        return {
            "title": title,
            "text": full_text,
            "source": url,
            "type": "youtube"
        }
    except Exception as e:
        return {"error": f"Failed to process YouTube video: {str(e)}"}

def extract_from_website(url):
    """Extract text content from a website URL"""
    try:
        content = fetch_page_content(url)
        if not content:
            return {"error": "No extractable content found"}
        return {
            "title": f"Website: {url}",
            "text": content,
            "source": url,
            "type": "website"
        }
    except Exception as e:
        return {"error": f"Website processing failed: {str(e)}"}

def process_content(content_datas, web_search=True):
    """Process multiple content sources and generate enhanced notes."""
    combined_text = "\n\n".join([cd['text'] for cd in content_datas])
    titles = [cd['title'] for cd in content_datas]
    combined_title = " and ".join(titles) if len(titles) <= 3 else f"{len(titles)} combined sources"

    # Generate search queries and fetch web content if web search is enabled
    web_context = ""
    sources = []
    if web_search:
        search_queries = generate_search_queries(combined_text)
        for i, query in enumerate(search_queries, 1):
            urls = search_web(query, num_results=2)
            for j, url in enumerate(urls, 1):
                content = fetch_page_content(url)
                if content:
                    source_id = len(sources) + 1
                    sources.append(f"[[Source {source_id}: {url}]]")
                    web_context += f"[[Source {source_id}]]\n{content}\n\n"
    
    notes_prompt = f"""
    Create comprehensive and detailed study notes {'by combining the following original content with the additional web sources provided' if web_search else 'based on the following original content'}.
    Include all key points, explanations, and relevant details{' from both the original content and the web sources' if web_search else ''}.
    Organize the information into main topics and subtopics with bullet points. Use Markdown formatting for clarity.
    {'When incorporating information that originates from the web sources (not from the original content), cite them using [[Source X]]. Do not cite the original content.' if web_search else ''}
    
    Original Content:
    {combined_text}
    
    {'Additional Web Sources:' + web_context if web_search else ''}
    
    NOTES:
    """
    
    try:
        notes_response = model.generate_content(notes_prompt)
        if not notes_response.candidates:
            return {"error": "No response from API during notes generation"}
        candidate = notes_response.candidates[0]
        if candidate.finish_reason != 1:  # "STOP"
            return {"error": f"Notes generation did not complete successfully: {candidate.finish_reason}"}
        notes = candidate.content.parts[0].text
        if web_search and sources:
            notes += "\n\n**Sources:**\n" + "\n".join(sources)

        content_id = str(uuid.uuid4())
        conn = get_db_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "INSERT INTO content (id, title, source, content_type, original_text, notes, created_at, web_search_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (content_id, combined_title, "multiple sources", "multiple", combined_text, notes, datetime.now(), int(web_search))
            )
            conn.commit()
        except Exception as e:
            return {"error": f"Failed to save content to database: {str(e)}"}
        finally:
            conn.close()

        return {
            "content_id": content_id,
            "title": combined_title,
            "notes": notes
        }
    except Exception as e:
        return {"error": f"Failed to process content: {str(e)}"}

# --- Feature Generation Functions ---
def generate_quizzes(content_id, difficulty=None, num_questions=5):
    """Generate quiz questions with web-enhanced context."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT original_text, notes, web_search_enabled FROM content WHERE id = ?", (content_id,))
        result = cursor.fetchone()
        if not result:
            return {"error": "Content not found"}
        original_text, notes, web_search_enabled = result['original_text'], result['notes'], bool(result['web_search_enabled'])
    except Exception as e:
        return {"error": f"Failed to fetch content from database: {str(e)}"}
    finally:
        conn.close()

    if difficulty is None:
        difficulty = determine_quiz_difficulty(content_id)

    web_context = ""
    if web_search_enabled:
        search_queries = generate_search_queries(original_text)
        for query in search_queries:
            urls = search_web(query, num_results=1)
            for url in urls:
                content = fetch_page_content(url)
                if content:
                    web_context += f"\n\n{content}"

    quiz_prompt = f"""
    Create a quiz with {num_questions} questions based on the following notes{' and additional web context' if web_search_enabled else ''}.
    The questions should be at the '{difficulty}' level of Bloom's Taxonomy and contextually enriched.
    Each question should include:
    - A clear explanation of why the answer is correct
    - Common misconceptions for incorrect options
    - Additional context or related concepts

    NOTES:
    {notes}

    {'WEB CONTEXT:' + web_context if web_search_enabled else ''}

    Return a JSON array of objects with the following structure:
    [
        {{
            "question": "Question text",
            "options": ["Option A", "Option B", "Option C", "Option D"],
            "correct_answer": "Option A",
            "explanation": "Why this is the correct answer",
            "misconceptions": "Common misconceptions about this topic",
            "related_concepts": "Additional context or related ideas",
            "bloom_level": "{difficulty}"
        }}
    ]
    Ensure the response is a valid JSON array.
    """
    try:
        quiz_response = model.generate_content(quiz_prompt)
        if not quiz_response.candidates:
            return {"error": "No response from API during quiz generation"}
        candidate = quiz_response.candidates[0]
        if candidate.finish_reason != 1:  # "STOP"
            return {"error": f"Quiz generation did not complete successfully: {candidate.finish_reason}"}
        text = candidate.content.parts[0].text
        if text.startswith("```json") and text.endswith("```"):
            text = text[7:-3].strip()
        try:
            questions = json.loads(text)
            quiz_id = str(uuid.uuid4())
            conn = get_db_connection()
            cursor = conn.cursor()
            try:
                cursor.execute(
                    "INSERT INTO quizzes (id, content_id, questions, bloom_level) VALUES (?, ?, ?, ?)",
                    (quiz_id, content_id, json.dumps(questions), difficulty)
                )
                conn.commit()
            except Exception as e:
                return {"error": f"Failed to save quiz to database: {str(e)}"}
            finally:
                conn.close()
            return {
                "quiz_id": quiz_id,
                "questions": questions,
                "bloom_level": difficulty
            }
        except json.JSONDecodeError as e:
            print(f"Error parsing quiz questions: {text}, Error: {str(e)}")
            return {"error": f"Failed to parse quiz questions: {str(e)}"}
    except Exception as e:
        return {"error": f"Failed to generate quiz: {str(e)}"}

def determine_quiz_difficulty(content_id):
    """Determine quiz difficulty based on past performance."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT bloom_level, AVG(correct_answers*1.0/total_questions) as avg_score 
            FROM user_performance 
            WHERE content_id = ? 
            GROUP BY bloom_level
            ORDER BY avg_score DESC
            """,
            (content_id,)
        )
        performance = cursor.fetchall()
    except Exception as e:
        print(f"Error fetching performance data: {str(e)}")
        performance = []
    finally:
        conn.close()
    bloom_levels = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"]
    if not performance:
        return "Remember"
    for level, score in performance:
        level_index = bloom_levels.index(level)
        if score < 0.6 and level_index > 0:
            return bloom_levels[level_index - 1]
        elif score > 0.85 and level_index < len(bloom_levels) - 1:
            return bloom_levels[level_index + 1]
        elif 0.6 <= score <= 0.85:
            return level
    return performance[0][0] if performance else "Understand"

def generate_flashcards(content_id):
    """Generate flashcards from notes."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT notes FROM content WHERE id = ?", (content_id,))
        result = cursor.fetchone()
        if not result:
            return {"error": "Content not found"}
        notes = result['notes']
    except Exception as e:
        return {"error": f"Failed to fetch content from database: {str(e)}"}
    finally:
        conn.close()
    flashcard_prompt = f"""
    Create 10 flashcards based on the following notes.
    Each flashcard should have a clear question and a concise answer.

    NOTES:
    {notes}

    Return a JSON array of objects with the following structure:
    [
        {{
            "question": "Question text",
            "answer": "Answer text"
        }}
    ]
    Ensure the response is a valid JSON array.
    """
    try:
        flashcard_response = model.generate_content(flashcard_prompt)
        if not flashcard_response.candidates:
            return {"error": "No response from API during flashcard generation"}
        candidate = flashcard_response.candidates[0]
        if candidate.finish_reason != 1:  # "STOP"
            return {"error": f"Flashcard generation did not complete successfully: {candidate.finish_reason}"}
        text = candidate.content.parts[0].text
        if text.startswith("```json") and text.endswith("```"):
            text = text[7:-3].strip()
        try:
            flashcards = json.loads(text)
            flashcard_id = str(uuid.uuid4())
            conn = get_db_connection()
            cursor = conn.cursor()
            try:
                cursor.execute(
                    "INSERT INTO flashcards (id, content_id, cards) VALUES (?, ?, ?)",
                    (flashcard_id, content_id, json.dumps(flashcards))
                )
                conn.commit()
            except Exception as e:
                return {"error": f"Failed to save flashcards to database: {str(e)}"}
            finally:
                conn.close()
            return {
                "flashcard_id": flashcard_id,
                "flashcards": flashcards
            }
        except json.JSONDecodeError as e:
            print(f"Error parsing flashcards: {text}, Error: {str(e)}")
            return {"error": f"Failed to parse flashcards: {str(e)}"}
    except Exception as e:
        return {"error": f"Failed to generate flashcards: {str(e)}"}

class ChatSession:
    """Manages chat history for a content item."""
    def __init__(self, content_id, history=None):
        self.content_id = content_id
        self.history = history or []

    def add_message(self, role, parts):
        self.history.append({"role": role, "parts": parts})

    def get_history(self):
        return self.history

    def load_history_from_db(self):
        conn = get_db_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT history FROM chat_history WHERE content_id=?", (self.content_id,))
            result = cursor.fetchone()
            if result:
                try:
                    self.history = json.loads(result['history'])
                except json.JSONDecodeError:
                    print("Warning: Could not decode chat history from DB.")
                    self.history = []
            else:
                self.history = []
        except Exception as e:
            print(f"Error loading chat history: {str(e)}")
            self.history = []
        finally:
            conn.close()

    def save_history_to_db(self):
        conn = get_db_connection()
        cursor = conn.cursor()
        history_json = json.dumps(self.history)
        try:
            cursor.execute("SELECT id FROM chat_history WHERE content_id = ?", (self.content_id,))
            existing_history = cursor.fetchone()
            if existing_history:
                cursor.execute("UPDATE chat_history SET history = ? WHERE content_id = ?", (history_json, self.content_id))
            else:
                history_id = str(uuid.uuid4())
                cursor.execute("INSERT INTO chat_history (id, content_id, history) VALUES (?, ?, ?)", (history_id, self.content_id, history_json))
            conn.commit()
        except Exception as e:
            print(f"Error saving chat history: {str(e)}")
        finally:
            conn.close()

def chat_with_content(content_id, user_message):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT notes FROM content WHERE id = ?", (content_id,))
    content_result = cursor.fetchone()
    conn.close()
    if not content_result:
        return {"error": "Content not found"}
    notes = content_result['notes']
    chat_session = ChatSession(content_id)
    chat_session.load_history_from_db()
    if not chat_session.get_history():
        # Add initial context with study notes
        chat_session.add_message("model", ["Here are the study notes for your reference: " + notes])
    chat_session.add_message("user", [user_message])
    chat = model.start_chat(history=chat_session.get_history()[:-1])
    try:
        response = chat.send_message(chat_session.get_history()[-1]["parts"])
        if response.candidates:
            candidate = response.candidates[0]
            if candidate.finish_reason == 1:  # "STOP"
                assistant_message = candidate.content.parts[0].text
                chat_session.add_message("model", [assistant_message])
                chat_session.save_history_to_db()
                return {
                    "response": assistant_message,
                    "history": chat_session.get_history()
                }
            else:
                return {"error": f"Chat response generation incomplete: {candidate.finish_reason}"}
        else:
            return {"error": "No chat response from API"}
    except Exception as e:
        return {"error": f"Failed to generate chat response: {str(e)}"}

def record_quiz_performance(content_id, quiz_id, bloom_level, correct, total):
    """Record quiz performance in the database."""
    try:
        performance_id = str(uuid.uuid4())
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO user_performance (id, content_id, quiz_id, bloom_level, correct_answers, total_questions) VALUES (?, ?, ?, ?, ?, ?)",
            (performance_id, content_id, quiz_id, bloom_level, correct, total)
        )
        conn.commit()
        conn.close()
        return {"success": True, "performance_id": performance_id}
    except Exception as e:
        return {"error": f"Failed to record performance: {str(e)}"}

# --- API Routes ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/process-content', methods=['POST'])
def process_content_route():
    try:
        web_search = request.form.get('web_search', 'true').lower() == 'true'
        urls = json.loads(request.form.get('urls', '[]'))
        files = request.files.getlist('files')
        content_datas = []

        # Process URLs
        for url in urls:
            if 'youtube.com' in url or 'youtu.be' in url:
                content_data = extract_from_youtube(url)
            else:
                content_data = extract_from_website(url)
            
            if 'error' in content_data:
                return jsonify({"error": content_data['error']}), 400
            content_datas.append(content_data)

        # Process Files using Gemini API
        for file in files:
            filename = secure_filename(file.filename)
            temp_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(temp_path)
            
            # Determine MIME type
            mime_type = {
                '.pdf': 'application/pdf',
                '.mp3': 'audio/mp3',
                '.wav': 'audio/wav',
                '.mp4': 'video/mp4',
                '.mov': 'video/quicktime'
            }.get(os.path.splitext(filename)[1].lower(), 'application/octet-stream')

            try:
                # Upload to Gemini
                gemini_file = upload_to_gemini(temp_path, mime_type)
                
                # Generate extraction prompt
                prompt = f"Extract and return all text content from this {mime_type.split('/')[0]} file. Return only the raw text without any formatting."
                response = model.generate_content([prompt, gemini_file])
                
                if not response.text:
                    raise ValueError("No content extracted")
                
                content_datas.append({
                    "title": filename,
                    "text": response.text,
                    "source": filename,
                    "type": mime_type.split('/')[0]
                })
                
            finally:
                os.remove(temp_path)
                genai.delete_file(gemini_file.name)

        result = process_content(content_datas, web_search)
        if 'error' in result:
            return jsonify(result), 500
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": f"Error processing content: {str(e)}"}), 500

@app.route('/api/generate-quizzes/<content_id>', methods=['GET'])
def get_quizzes(content_id):
    difficulty = request.args.get('difficulty')
    result = generate_quizzes(content_id, difficulty)
    return jsonify(result)

@app.route('/api/generate-flashcards/<content_id>', methods=['GET'])
def get_flashcards(content_id):
    result = generate_flashcards(content_id)
    return jsonify(result)

@app.route('/api/chat/<content_id>', methods=['POST'])
def chat(content_id):
    data = request.json
    message = data.get('message')
    if not message:
        return jsonify({"error": "No message provided"}), 400
    result = chat_with_content(content_id, message)
    return jsonify(result)

@app.route('/api/record-performance', methods=['POST'])
def record_performance():
    data = request.json
    content_id = data.get('content_id')
    quiz_id = data.get('quiz_id')
    bloom_level = data.get('bloom_level')
    correct = data.get('correct_answers')
    total = data.get('total_questions')
    if not all([content_id, quiz_id, bloom_level, correct is not None, total is not None]):
        return jsonify({"error": "Missing required parameters"}), 400
    result = record_quiz_performance(content_id, quiz_id, bloom_level, correct, total)
    return jsonify(result)

@app.route('/api/content/<content_id>', methods=['GET'])
def get_content(content_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id, title, source, content_type, original_text, notes, created_at, web_search_enabled FROM content WHERE id = ?", (content_id,))
        result = cursor.fetchone()
        if not result:
            return jsonify({"error": "Content not found"}), 404
        return jsonify({
            "id": result['id'],
            "title": result['title'],
            "source": result['source'],
            "content_type": result['content_type'],
            "original_text": result['original_text'],
            "notes": result['notes'],
            "created_at": result['created_at'],
            "web_search_enabled": bool(result['web_search_enabled'])
        })
    except Exception as e:
        return jsonify({"error": f"Failed to fetch content: {str(e)}"}), 500
    finally:
        conn.close()

@app.route('/api/list-content', methods=['GET'])
def list_content():
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id, title, source, content_type, created_at, web_search_enabled FROM content ORDER BY created_at DESC")
        results = cursor.fetchall()
        content_list = [{
            "id": row['id'],
            "title": row['title'],
            "source": row['source'],
            "content_type": row['content_type'],
            "created_at": row['created_at'],
            "web_search_enabled": bool(row['web_search_enabled'])
        } for row in results]
        return jsonify({"content": content_list})
    except Exception as e:
        return jsonify({"error": f"Failed to list content: {str(e)}"}), 500
    finally:
        conn.close()

# --- Error Handlers ---
@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({"error": "File too large"}), 413

@app.errorhandler(500)
def internal_server_error(error):
    return jsonify({"error": "Internal server error"}), 500

@app.errorhandler(400)
def bad_request(error):
    return jsonify({"error": "Bad request"}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Resource not found"}), 404

# --- Main Entry Point ---
if __name__ == '__main__':
    init_db()
    app.run(debug=True)
