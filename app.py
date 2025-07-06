from flask import Flask, request, jsonify, render_template
import os
import tempfile 
import pathlib 
import google.generativeai as genai
import json
import uuid
from datetime import datetime
import requests
import time
from bs4 import BeautifulSoup
from urllib.parse import urlparse, parse_qs
import urllib3
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import re
import tempfile
from werkzeug.utils import secure_filename
import pathlib 
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound, CouldNotRetrieveTranscript, FetchedTranscript

# --- Basic App Configuration ---
def init_app():
    app = Flask(__name__, static_folder='static', template_folder='templates')
    app.secret_key = os.urandom(24)
    # Removed DB config, upload folder (using Gemini directly)
    return app

app = init_app()

DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-preview-05-20"
# gemini-2.5-flash-preview-05-20

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
    model = genai.GenerativeModel(DEFAULT_GEMINI_MODEL)
    return model, genai, SEARCH_ENGINE_ID

model, genai_api, SEARCH_ENGINE_ID = configure_api()

# --- Web Search Helper Functions (Keep as is, but check SEARCH_ENGINE_ID usage) ---
def create_http_session():
    session = requests.Session()
    retries = Retry(
        total=3,
        backoff_factor=1,
        status_forcelist=[500, 502, 503, 504],
        allowed_methods=frozenset(['GET', 'POST'])
    )
    session.mount('https://', HTTPAdapter(max_retries=retries))
    return session

def search_web(query, num_results=5):
    """Search with retries and better error handling"""
    if not SEARCH_ENGINE_ID or not os.environ.get("GOOGLE_API_KEY"):
        print("Warning: Web search disabled. Missing GOOGLE_API_KEY or SEARCH_ENGINE_ID.")
        return []
    url = "https://www.googleapis.com/customsearch/v1"
    params = {
        "key": os.environ.get("GOOGLE_API_KEY"),
        "cx": SEARCH_ENGINE_ID,
        "q": query,
        "num": num_results,
    }

    session = create_http_session()
    try:
        response = session.get(url, params=params, timeout=10)
        response.raise_for_status()
        results = response.json()
        # Return link and snippet for better context
        return [{"link": item['link'], "snippet": item.get('snippet', '')} for item in results.get('items', [])]
    except Exception as e:
        print(f"Search error: {str(e)}")
        return []

def fetch_page_content(url):
    """Fetch content with better headers and timeout handling"""
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Accept-Encoding": "gzip, deflate",
            "Connection": "keep-alive",
            "Referer": "https://www.google.com/"
        }
        session = create_http_session()
        response = session.get(url, headers=headers, timeout=15)
        response.raise_for_status() # Check for HTTP errors

        content_type = response.headers.get('Content-Type', '')
        if 'text/html' not in content_type:
            print(f"Skipping non-HTML content at {url}")
            return "" # Skip non-html content

        soup = BeautifulSoup(response.content, 'html.parser')
        # More robust content extraction
        for element in soup(['script', 'style', 'nav', 'footer', 'header', 'form', 'aside', 'figure', 'img']):
            element.decompose()

        # Try common main content tags
        main_content = soup.find('article') or soup.find('main') or soup.find('div', role='main') or soup.find('div', class_=re.compile("content|main|post|body", re.I)) or soup.body

        text_parts = []
        if main_content:
             # Prioritize text within paragraphs, headings, list items
            for element in main_content.find_all(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'pre', 'code', 'blockquote', 'td'], recursive=True):
                 # Get text, strip whitespace, handle None case
                element_text = element.get_text(separator=' ', strip=True)
                if element_text:
                    text_parts.append(element_text)
        else:
             # Fallback: Get all text from body if specific tags fail
            body_text = soup.body.get_text(separator=' ', strip=True) if soup.body else ""
            if body_text:
                 text_parts.append(body_text)

        full_text = '\n'.join(text_parts)
        # Remove excessive blank lines
        full_text = re.sub(r'\n\s*\n', '\n\n', full_text)
        return full_text[:15000]  # Limit to 15k characters
    except requests.exceptions.RequestException as e:
        print(f"Network error fetching {url}: {str(e)}")
        return ""
    except Exception as e:
        print(f"Error processing {url}: {str(e)}")
        return ""

def generate_search_queries(context_text, num_queries=3):
    """Generate relevant search queries using Gemini."""
    prompt = f"""
    Context:
    {context_text[:2000]} # Limit context for query generation

    Based on the context provided above, generate {num_queries} distinct and relevant search queries to find additional information that could enhance understanding of the topic. Focus on key concepts, ambiguities, or areas needing elaboration present in the text.
    Return the queries as a JSON array of strings, for example: ["query1", "query2", "query3"].
    Ensure the response is ONLY the valid JSON array and nothing else.
    """
    try:
        response = model.generate_content(prompt)
        if not response.candidates:
            print("No candidates in search query response")
            return []

        # Access text safely using recommended attributes
        text = ""
        if response.candidates[0].content and response.candidates[0].content.parts:
            text = response.candidates[0].content.parts[0].text
        else:
             # Fallback for potential variations in response structure
             try:
                text = response.text
             except AttributeError:
                 print("Could not extract text from search query response.")
                 return []


        # Improved JSON parsing
        cleaned_text = text.strip()
        if cleaned_text.startswith("```json"):
            cleaned_text = cleaned_text[7:]
        if cleaned_text.endswith("```"):
            cleaned_text = cleaned_text[:-3]
        cleaned_text = cleaned_text.strip()

        try:
            queries = json.loads(cleaned_text)
            if isinstance(queries, list) and all(isinstance(q, str) for q in queries):
                return queries[:num_queries] # Ensure correct number
            else:
                print(f"Invalid query format received: {cleaned_text}")
                # Attempt to extract queries if format is slightly off
                found_queries = re.findall(r'"(.*?)"', cleaned_text)
                if found_queries and len(found_queries) <= num_queries:
                    print(f"Attempting recovery, extracted: {found_queries}")
                    return found_queries
                return []
        except json.JSONDecodeError as e:
            print(f"Error parsing search queries JSON: {cleaned_text}, Error: {str(e)}")
            # Attempt regex extraction as fallback
            found_queries = re.findall(r'"(.*?)"', cleaned_text)
            if found_queries and len(found_queries) <= num_queries:
                 print(f"JSON failed, attempting recovery, extracted: {found_queries}")
                 return found_queries
            return []
    except Exception as e:
        print(f"Error generating search queries with Gemini: {str(e)}")
        # Add specific error handling if needed, e.g., for API quota issues
        if "API key not valid" in str(e):
             print("Please check your GOOGLE_API_KEY.")
        return []


# --- Content Processing Functions ---
def extract_video_id(url):
    """Extract YouTube video ID from URL, supporting various formats. (Keep as is)"""
    parsed = urlparse(url)
    # ... (keep existing logic) ...
    if parsed.netloc == 'youtu.be':
        path_segments = parsed.path.split('/')
        video_id = path_segments[1] if len(path_segments) > 1 else None
        if video_id:
            return video_id.split('?')[0]
        else:
            # Allows URLs like youtu.be/VIDEOID?si=...
            if 'si' in parse_qs(parsed.query) and len(path_segments) > 1:
                return path_segments[1].split('?')[0]
            raise ValueError("Invalid YouTube URL: No video ID found in youtu.be path")

    elif parsed.netloc in ('www.youtube.com', 'youtube.com', 'm.youtube.com'):
        query_params = parse_qs(parsed.query)
        if parsed.path == '/watch' and 'v' in query_params:
            return query_params['v'][0]
        elif parsed.path == '/live' and len(parsed.path.split('/')) > 2:
             return parsed.path.split('/')[2].split('?')[0]
        elif parsed.path.startswith('/embed/'):
             return parsed.path.split('/')[2].split('?')[0]
        elif parsed.path.startswith('/shorts/'):
             return parsed.path.split('/')[2].split('?')[0]

        # Handle URLs like youtube.com/v/VIDEOID or youtube.com/VIDEOID
        path_segments = parsed.path.split('/')
        if len(path_segments) >= 2:
            if path_segments[1] == 'v' and len(path_segments) > 2:
                return path_segments[2].split('?')[0]
            # Check if the second segment looks like a video ID
            elif len(path_segments[1]) == 11 and not path_segments[1] in ['watch', 'feed', 'channel', 'user', 'playlist']:
                 # Basic check for likely video ID format
                 return path_segments[1].split('?')[0]

    raise ValueError(f"Invalid YouTube URL format: {url}")

def extract_from_youtube(url):
    """Extract content from YouTube video with better transcript and connection error handling"""
    try:
        video_id = extract_video_id(url)
        api = YouTubeTranscriptApi()

        # --- Try fetching transcripts ---
        try:
            transcript_list = api.list_transcripts(video_id)
        except requests.exceptions.ConnectionError as conn_err:
            error_msg = f"Network error connecting to YouTube ({url}): {str(conn_err)}. Please check internet connection and DNS settings."
            print(error_msg)
            if "Failed to resolve" in str(conn_err) or "getaddrinfo failed" in str(conn_err):
                return {"error": "Could not connect to YouTube. Please check your internet connection and DNS settings (Failed to resolve hostname)."}
            return {"error": f"Network error: {str(conn_err)}"}
        except Exception as list_transcript_err:
            # Catch other errors during transcript listing (e.g., API changes)
            error_msg = f"Error listing transcripts for YouTube video ({url}): {str(list_transcript_err)}"
            print(error_msg)
            # Check for common API errors if needed, otherwise return generic
            return {"error": error_msg}
        # --- End transcript fetching attempt ---


        transcript = None
        # Find transcript logic (keep the improved fallback logic)
        try: transcript = transcript_list.find_manually_created_transcript(['en', 'en-US', 'en-GB'])
        except NoTranscriptFound: pass
        if not transcript:
            try: transcript = transcript_list.find_generated_transcript(['en', 'en-US', 'en-GB'])
            except NoTranscriptFound: pass
        if not transcript:
            available_transcripts = list(transcript_list)
            manual = [t for t in available_transcripts if not t.is_generated]
            generated = [t for t in available_transcripts if t.is_generated]
            if manual: transcript = manual[0]
            elif generated: transcript = generated[0]
            else: raise NoTranscriptFound("No transcripts found for this video.")
        if not transcript: raise NoTranscriptFound("No suitable transcript could be selected.")

        print(f"Selected transcript language: {transcript.language} (Code: {transcript.language_code}), Generated: {transcript.is_generated}")

        # Fetch the transcript data object
        fetched_transcript_data = transcript.fetch()

        # --- Correction for ValueError: Access .text attribute ---
        extracted_texts = []
        iterable_source = None

        # Determine the correct source to iterate over
        if isinstance(fetched_transcript_data, list):
             iterable_source = fetched_transcript_data # It's already a list of dicts (maybe?)
        elif hasattr(fetched_transcript_data, 'segments') and isinstance(getattr(fetched_transcript_data, 'segments'), list):
             iterable_source = fetched_transcript_data.segments # Iterate over the .segments list
        else:
             # Assume the object itself is iterable (like FetchedTranscript)
             iterable_source = fetched_transcript_data

        # Iterate and access .text attribute
        try:
            for entry in iterable_source:
                # Check if the entry object has a 'text' attribute
                if hasattr(entry, 'text'):
                    extracted_texts.append(entry.text)
                # Fallback check if it's unexpectedly a dict
                elif isinstance(entry, dict) and 'text' in entry:
                     extracted_texts.append(entry['text'])
                     print("Warning: Transcript segment was a dict, expected object with .text")

            if not extracted_texts:
                 print(f"Warning: Iteration over transcript data yielded no text. Source type: {type(iterable_source)}, Data sample: {str(iterable_source)[:200]}")
                 # Allow empty text, don't raise error here, handle later if needed

        except TypeError as iter_error:
             print(f"Error: Determined transcript source (type {type(iterable_source)}) is not iterable. Original fetched type: {type(fetched_transcript_data)}")
             raise TypeError(f"Unexpected transcript data format: source not iterable.") from iter_error

        # Join the extracted texts
        full_text = " ".join(extracted_texts).replace("\n", " ").strip()
        # --- End Correction ---


        if not full_text:
             print(f"Warning: Extracted transcript text is empty for {url}.")
             # Proceeding with empty text

        lang_code = transcript.language_code
        lang_note = f"[Transcript Language: {lang_code}]"

        # Attempt to fetch title (best effort)
        title = f"YouTube Video (ID: {video_id})"
        try:
            video_url = f"https://www.youtube.com/watch?v={video_id}"
            session = create_http_session()
            response = session.get(video_url, headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.5"}, timeout=10) # Increased timeout slightly
            response.raise_for_status()
            soup = BeautifulSoup(response.content, 'html.parser')
            title_tag = soup.find('title')
            meta_title = soup.find('meta', property='og:title')
            if meta_title and meta_title.get('content'):
                title = meta_title['content'].strip()
            elif title_tag and title_tag.text:
                 cleaned_title = title_tag.text.replace(" - YouTube", "").strip()
                 title = cleaned_title
        except requests.exceptions.RequestException as title_req_err:
            # Catch specific request errors during title fetch
             error_msg = f"Could not fetch YouTube title for {video_id} due to network issue: {title_req_err}"
             print(error_msg)
             # Don't fail the whole process, just use default title
        except Exception as title_e:
            print(f"Could not fetch YouTube title for {video_id}: {title_e}")


        return {
            "title": title,
            "text": f"{lang_note}\n{full_text}",
            "source": url,
            "type": "youtube"
        }
    # --- Catch specific YouTube API errors ---
    except (TranscriptsDisabled, NoTranscriptFound, CouldNotRetrieveTranscript) as yt_api_e:
         error_msg = f"Failed to get transcript for YouTube video ({url}): {str(yt_api_e)}"
         print(error_msg)
         return {"error": error_msg}
    # --- Catch other general exceptions ---
    except Exception as e:
        error_msg = f"Failed to process YouTube video ({url}): {str(e)}"
        print(error_msg)
        return {"error": error_msg}

def extract_from_website(url):
    """Extract text content from a website URL"""
    try:
        content = fetch_page_content(url)
        if not content:
            # Check if URL might be a direct link to PDF, etc.
            parsed_url = urlparse(url)
            if parsed_url.path.lower().endswith(('.pdf', '.doc', '.docx', '.ppt', '.pptx')):
                 return {"error": f"Direct file link detected ({url}). Please upload files directly."}
            return {"error": f"No extractable text content found at {url}. The page might be dynamic (JavaScript-heavy) or empty."}

        # Try to get a better title
        title = f"Website: {urlparse(url).netloc}" # Default title
        try:
            # Re-fetch small part just for title (or use previous response if cached/efficient)
            session = create_http_session()
            response = session.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=5, stream=True) # Stream to get head quickly
            response.raise_for_status()
            # Read only enough to find the title
            html_head = response.raw.read(2048).decode('utf-8', errors='ignore')
            response.close()
            soup = BeautifulSoup(html_head, 'html.parser')
            title_tag = soup.find('title')
            meta_title = soup.find('meta', property='og:title')
            if meta_title and meta_title.get('content'):
                title = meta_title['content'].strip()
            elif title_tag and title_tag.text:
                 title = title_tag.text.strip()

        except Exception as title_e:
            print(f"Could not fetch website title for {url}: {title_e}")


        return {
            "title": title,
            "text": content,
            "source": url,
            "type": "website"
        }
    except Exception as e:
        print(f"Website processing failed for {url}: {str(e)}")
        return {"error": f"Website processing failed: {str(e)}"}

def upload_file_to_gemini(file_storage):
    """Uploads a file to Gemini API and returns the file object upon success."""
    original_filename = file_storage.filename
    filename = secure_filename(original_filename)
    if not filename:
        filename = f"unnamed_file_{str(uuid.uuid4())[:8]}"
        print(f"Warning: Original filename '{original_filename}' was invalid, using fallback: {filename}")

    temp_id = str(uuid.uuid4())
    print(f"Preparing secure filename: {filename} (Temp ID: {temp_id}) for Gemini upload.")

    mime_type = file_storage.mimetype
    if not mime_type or mime_type == 'application/octet-stream':
        ext = os.path.splitext(original_filename)[1].lower()
        mime_map = {
             '.pdf': 'application/pdf',
             '.mp3': 'audio/mp3', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
             '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.mpeg': 'video/mpeg',
             '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
             '.txt': 'text/plain', '.md': 'text/markdown',
             '.doc': 'application/msword',
             '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
             '.ppt': 'application/vnd.ms-powerpoint',
             '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
         }
        mime_type = mime_map.get(ext, 'application/octet-stream')
        print(f"Inferred MIME type for {original_filename} as {mime_type}")

    # Basic MIME type check (Gemini handles more internally, but good to have a basic filter)
    supported_mime_prefixes = [
        'image/', 'audio/', 'video/', 'text/',
        'application/pdf', 'application/msword', 'application/vnd.openxmlformats', 'application/vnd.ms-powerpoint'
    ]
    is_potentially_supported = any(mime_type.startswith(prefix) for prefix in supported_mime_prefixes) or \
                              any(filename.lower().endswith(suffix) for suffix in ['.pdf', '.docx', '.pptx', '.txt', '.md', '.csv', '.json', '.html']) # Add common extensions

    if not is_potentially_supported:
        # Allow 'text/' like types to try direct processing later if needed, but others are likely unsupported by Gemini directly
        if not mime_type.startswith('text/'):
             print(f"Warning: File type ({mime_type} for {filename}) might not be directly processable by Gemini. Attempting upload anyway.")
             # Removed the strict rejection, letting the API decide, but log a warning.

    temp_file_path = None
    gemini_file = None
    try:
        file_bytes = file_storage.read()
        file_storage.seek(0) # Reset stream position in case it's needed again (though unlikely here)

        # Create a temporary file to store the bytes
        with tempfile.NamedTemporaryFile(delete=False, suffix=pathlib.Path(filename).suffix) as temp_file:
            temp_file.write(file_bytes)
            temp_file_path = temp_file.name # Get the path

        print(f"Uploading temporary file {temp_file_path} for {filename} ({mime_type}) to Gemini...")

        # Upload using the file path
        gemini_file = genai_api.upload_file(
            path=temp_file_path,
            display_name=filename, # Use secure filename as display name
            mime_type=mime_type
        )
        print(f"Upload initiated for {filename}. Gemini file name: {gemini_file.name}. Waiting for processing...")

        # Polling loop
        polling_attempts = 0
        max_polling_attempts = 12 # e.g., 1 minute if sleep is 5s
        while gemini_file.state.name == "PROCESSING" and polling_attempts < max_polling_attempts:
            time.sleep(5)
            polling_attempts += 1
            try:
                 gemini_file = genai_api.get_file(gemini_file.name)
                 print(f"File {gemini_file.name} state: {gemini_file.state.name} (Attempt {polling_attempts}/{max_polling_attempts})")
            except Exception as poll_error:
                 print(f"Error polling file status for {gemini_file.name}: {poll_error}")
                 # Don't immediately fail, maybe a transient issue
                 if polling_attempts >= max_polling_attempts:
                    raise RuntimeError(f"Failed to get file status after multiple attempts: {poll_error}")

        if gemini_file.state.name == "PROCESSING":
             print(f"File processing timed out for {filename} after {max_polling_attempts * 5} seconds.")
             # Attempt deletion here if timed out
             try:
                 genai_api.delete_file(gemini_file.name)
                 print(f"Deleted timed-out Gemini file: {gemini_file.name}")
             except Exception as delete_error:
                 print(f"Warning: Failed to delete timed-out Gemini file {gemini_file.name}: {delete_error}")
             return {"error": f"File processing timed out for '{original_filename}'."}

        if gemini_file.state.name != "ACTIVE":
            print(f"Gemini file processing failed for {filename}. Final state: {gemini_file.state.name}")
            # Attempt to delete the failed Gemini file
            try:
                genai_api.delete_file(gemini_file.name)
                print(f"Deleted failed Gemini file: {gemini_file.name}")
            except Exception as delete_error:
                print(f"Warning: Failed to delete failed Gemini file {gemini_file.name}: {delete_error}")
            return {"error": f"File processing failed for '{original_filename}' (State: {gemini_file.state.name})"}

        print(f"File {filename} ({gemini_file.name}) is ACTIVE.")
        # Return the gemini_file object itself, along with original name for reference
        return {"file_object": gemini_file, "original_filename": original_filename}

    except Exception as e:
        print(f"Error uploading/processing file {original_filename} with Gemini: {str(e)}")
        # Clean up Gemini file if upload partially succeeded before error
        if gemini_file and gemini_file.name:
            try:
                state_check = genai_api.get_file(gemini_file.name) # Check state before deleting
                if state_check.state.name != "DELETED":
                     genai_api.delete_file(gemini_file.name)
                     print(f"Deleted Gemini file {gemini_file.name} due to error during upload/processing.")
            except Exception as delete_error:
                print(f"Warning: Failed to delete Gemini file {gemini_file.name} after error: {delete_error}")
        return {"error": f"Failed to upload/process file '{original_filename}': {str(e)}"}

    finally:
        # Delete the local temporary file
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
                # print(f"Deleted local temporary file: {temp_file_path}") # Optional: uncomment for verbose logging
            except Exception as delete_temp_error:
                print(f"Warning: Failed to delete local temporary file {temp_file_path}: {delete_temp_error}")

def process_content(content_items, topic=None, description=None, web_search=True):
    """
    Process mixed content sources (text, file objects), user topic/desc,
    and generate enhanced notes using direct multimodal input.
    """
    if not content_items and not (topic and description):
         return {"error": "No content provided (URLs, files, or topic/description)."}

    # Separate text content from file objects for prompt construction and original text aggregation
    text_contents = []
    file_objects = []
    titles = [] # Collect titles/filenames from all sources
    original_text_sources = [] # To build the combined original text for downstream use

    if topic:
         titles.append(f"Topic: {topic}")
         if description:
             original_text_sources.append(f"Topic: {topic}\nDescription: {description}")
         else:
             original_text_sources.append(f"Topic: {topic}")
    elif description:
         original_text_sources.append(f"Description: {description}")
         titles.append("User Description")

    for item in content_items:
        if isinstance(item, dict): # Likely from URL processing or file upload result
            if 'error' in item: continue
            if 'text' in item: # It's extracted text (e.g., from website, youtube)
                text_contents.append(item['text'])
                titles.append(item.get('title', item.get('source', 'Unknown Text Source')))
                original_text_sources.append(item['text'])
            elif 'file_object' in item: # It's an uploaded file object
                file_objects.append(item['file_object'])
                titles.append(item.get('original_filename', getattr(item['file_object'], 'display_name', 'Uploaded File')))
            else:
                 print(f"Warning: Skipping unknown item format in content_items: {item}")
        elif isinstance(item, str): # Direct text string
             text_contents.append(item)
             original_text_sources.append(item)
             titles.append("Provided Text Snippet")
        else:
             print(f"Warning: Skipping unknown item type in content_items: {type(item)}")

    # Combine only the textual original content
    combined_original_text = "\n\n---\n\n".join(original_text_sources)

    if not text_contents and not file_objects and not (topic and description):
        return {"error": "No processable content found after initial filtering."}

    # --- Build Prompt for Notes Generation (Multimodal) ---
    notes_prompt_parts = []
    notes_prompt_parts.append("You are an expert academic assistant tasked with creating comprehensive study notes in English.")

    user_context_prompt = ""
    if topic: user_context_prompt += f"User Provided Topic: {topic}\n"
    if description: user_context_prompt += f"User Provided Description:\n{description}\n"
    if user_context_prompt:
         notes_prompt_parts.append("**User Context:**")
         notes_prompt_parts.append(user_context_prompt)

    notes_prompt_parts.append("**Primary Content Sources:**")
    source_count = 0

    # *** FIX: Initialize combined_text_for_prompt here ***
    combined_text_for_prompt = ""

    if text_contents:
        source_count += len(text_contents)
        notes_prompt_parts.append("\n*Textual Content:*")
        # Now combine text snippets
        combined_text_for_prompt = "\n\n---\n\n".join(text_contents) # Assign value here
        notes_prompt_parts.append(combined_text_for_prompt[:30000])
        if len(combined_text_for_prompt) > 30000:
            notes_prompt_parts.append("\n[... Additional textual content truncated for brevity in prompt ...]")

    if file_objects:
        source_count += len(file_objects)
        notes_prompt_parts.append("\n*Referenced Files:*")
        for file_obj in file_objects:
            display_name = getattr(file_obj, 'display_name', file_obj.name)
            notes_prompt_parts.append(f"\n--- File: {display_name} (MIME: {file_obj.mime_type}) ---")
            notes_prompt_parts.append(file_obj)
        notes_prompt_parts.append("\n(Analyze the full content of the files referenced above)")

    print(f"Generating notes from {source_count} primary sources ({len(text_contents)} text, {len(file_objects)} files).")
    if not text_contents and not file_objects:
        print("Warning: No primary text or file content; relying solely on user topic/description and web search.")

    # --- Web Search (Based on Textual Context) ---
    web_search_context = ""
    web_sources_list = []
    # Generate queries based on available text (user context + extracted text)
    # Now combined_text_for_prompt is guaranteed to exist
    context_for_search_query = user_context_prompt + combined_text_for_prompt
    if web_search and SEARCH_ENGINE_ID and context_for_search_query.strip(): # Check if context is not empty
        print("Web search enabled. Generating queries...")
        search_queries = generate_search_queries(context_for_search_query, num_queries=3)
        print(f"Generated queries: {search_queries}")
        if search_queries:
            web_search_context += "\n\n--- Relevant Web Search Results ---\n"
            source_counter = 1
            processed_urls = set()

            for i, query in enumerate(search_queries, 1):
                print(f"Searching for: '{query}'")
                urls_data = search_web(query, num_results=2)
                print(f"Found URLs: {[u['link'] for u in urls_data]}")

                for url_data in urls_data:
                    url = url_data['link']
                    if url in processed_urls: continue
                    print(f"Fetching content from: {url}")
                    content = fetch_page_content(url)
                    processed_urls.add(url)
                    if content:
                        source_ref = f"Source {source_counter}"
                        web_sources_list.append({"ref": source_ref, "url": url})
                        web_search_context += f"\n[{source_ref}]\nURL: {url}\nSnippet: {url_data.get('snippet','')}\nContent Summary:\n{content[:1000]}...\n"
                        source_counter += 1
                        if len(web_search_context) > 20000:
                            print("Web context limit reached.")
                            break
                if len(web_search_context) > 20000: break
    # --- End Web Search ---

    if web_search_context:
        notes_prompt_parts.append(f"**Additional Context from Web Search:**\n{web_search_context}")
        notes_prompt_parts.append(f"\nWhen incorporating information *only* found in web sources, cite using the format [{web_sources_list[i]['ref']}] corresponding to the source list below. Do not cite the primary content or user context.")

    # Calculate dynamic length based on combined *text* length for guidance
    content_length = len(combined_text_for_prompt) + len(user_context_prompt)
    lower_target_length = max(500, min(int(content_length * 0.15), 50000))
    upper_target_length = max(800, min(int(content_length * 0.30), 75000))

    # --- Final Instructions ---
    notes_prompt_parts.append(f"""
**Instructions for Note Generation:**

1.  **Synthesize ALL provided information:** Combine the user's context, the primary textual content, the web search results (if any), AND THE CONTENT of the referenced files into a single, coherent set of study notes in English.
2.  **File Content:** Directly analyze and incorporate relevant information from the provided files (text documents, presentations, images, audio/video transcripts etc.).
3.  **Comprehensive Coverage:** Ensure all key concepts, definitions, explanations, examples, arguments, and data points from *all* sources are included.
4.  **Structure and Clarity:** Organize the notes logically using Markdown (headings, lists, bold, italics, code, blockquotes, horizontal rules).
5.  **Technical Formatting:** Use LaTeX for math ($inline$, $$display$$), triple backticks for code blocks (```python ... ```).
6.  **Special Markers:** Use `**Definition:**`, `**Key Concept:**`, `**Example:**`, `**Theorem:**`, `**Proof:**`, `**Algorithm:**`, `**Warning:**`, `**Note:**` consistently.
7.  **Academic Tone:** Clear, objective, formal style.
8.  **Citation (Web Sources Only):** Cite information *exclusively* from web sources using bracketed references (e.g., [Source 1]). Do *not* cite the primary content or files.
9.  **Length:** Aim for detailed notes, targeting a length between {lower_target_length} and {upper_target_length} characters, but prioritize completeness and clarity. The final length should reflect the complexity of *all* source material (including files).
10. **Language:** Notes must be in English.
11. **Output:** Generate ONLY the Markdown notes. No preamble or concluding remarks. Start directly with the content.
""")

    web_source_listing_for_prompt = ""
    if web_sources_list:
        web_source_listing_for_prompt = "\n\n---\n**Web Sources Referenced (for citation):**\n"
        for src in web_sources_list:
             web_source_listing_for_prompt += f"*   [{src['ref']}] {src['url']}\n"
        notes_prompt_parts.append(web_source_listing_for_prompt)


    # --- API Call ---
    try:
        notes_generation_model = genai.GenerativeModel(DEFAULT_GEMINI_MODEL)
        notes_response = notes_generation_model.generate_content(
            notes_prompt_parts,
            request_options={"timeout": 600}
            )

        # --- Response Handling (same as before) ---
        notes_text = ""
        if notes_response.candidates and notes_response.candidates[0].content and notes_response.candidates[0].content.parts:
             notes_text = notes_response.candidates[0].content.parts[0].text
             finish_reason = getattr(notes_response.candidates[0], 'finish_reason', None)
             if finish_reason and finish_reason != 1: # 1 = STOP
                print(f"Warning: Notes generation may be incomplete. Finish Reason: {finish_reason}")
                safety_ratings = getattr(notes_response.candidates[0], 'safety_ratings', None)
                if safety_ratings and any(r.probability >= 3 for r in safety_ratings):
                     notes_text += "\n\n[Note: Content may be truncated due to safety filters.]"
        elif hasattr(notes_response, 'prompt_feedback') and getattr(notes_response.prompt_feedback, 'block_reason', None):
             block_reason = notes_response.prompt_feedback.block_reason
             print(f"Notes generation blocked. Reason: {block_reason}")
             return {"error": f"Content processing failed due to prompt block: {block_reason}"}
        else:
             try:
                 notes_text = notes_response.text
             except AttributeError:
                 print("Critical: Could not extract text from notes generation response.")
                 print(f"Full notes response object: {notes_response}")
                 return {"error": "Failed to generate notes: No valid response text found."}

        # Append web source list to final output
        if web_sources_list:
             notes_text += web_source_listing_for_prompt

        # Generate title
        if not titles:
            combined_title = "Processed Content"
        elif len(titles) == 1:
            combined_title = titles[0]
        elif len(titles) <= 3:
            combined_title = " & ".join(titles)
        else:
            combined_title = f"{titles[0]} & {len(titles) - 1} other sources"

        content_session_id = str(uuid.uuid4())

        return {
            "content_id": content_session_id,
            "title": combined_title,
            "notes": notes_text,
            "original_text": combined_original_text, # Return only textual original content
            "web_search_enabled": web_search,
            "processed_file_names": [f.name for f in file_objects],
            "status": "success"
        }
    except Exception as e:
        print(f"Error during multimodal notes generation: {str(e)}")
        if "429" in str(e) or "Resource has been exhausted" in str(e):
            return {"error": "Rate limit or quota exceeded. Please try again later."}
        elif "Deadline Exceeded" in str(e) or "504" in str(e) or "timeout" in str(e):
             return {"error": "Notes generation timed out. The content might be too large or complex for the current model/settings."}
        # Handle specific API errors if needed
        elif "API key not valid" in str(e):
             return {"error": "Invalid Google API Key. Please check your configuration."}
        elif "permission" in str(e).lower():
             return {"error": f"API Permission Error: {str(e)}"}
        return {"error": f"Failed to generate notes: {str(e)}"}

# --- Feature Generation Functions (Modified for statelessness) ---
def generate_quizzes(notes, original_text, existing_questions_json="[]", question_types=None, num_questions=5, difficulty="Apply"):
    """Generate quiz questions based on provided text and notes, with difficulty control."""
    if not notes and not original_text:
        return {"error": "Cannot generate quiz without notes or original text."}

    if question_types is None:
        question_types = ["MCQ"] # Default to MCQ
    if not isinstance(question_types, list) or not question_types:
         question_types = ["MCQ"] # Fallback

    quiz_context = f"**Study Notes Snippet:**\n{notes[:10000]}\n\n**Original Text Snippet:**\n{original_text[:10000]}"
    if len(notes) > 10000 or len(original_text) > 10000:
        quiz_context += "\n\n[... Content truncated for quiz generation prompt ...]"

    existing_questions = []
    try:
        parsed_existing = json.loads(existing_questions_json)
        if isinstance(parsed_existing, list):
            existing_questions = parsed_existing
    except json.JSONDecodeError:
        print("Warning: Could not parse existing questions JSON.")

    existing_question_texts = [q.get('question', '') for q in existing_questions if q and q.get('question')]

    # --- MODIFIED PROMPT LOGIC FOR QUESTION TYPES ---
    question_types_instruction = ""
    if len(question_types) == 1:
        question_types_instruction = f"All {num_questions} questions MUST be of the following type: {question_types[0]}."
    else:
        question_types_instruction = f"Include a mix of the following types: {', '.join(question_types)}. Distribute the types reasonably among the {num_questions} questions requested."
    # --- END MODIFIED PROMPT LOGIC ---

    quiz_prompt = f"""
Context for Quiz Generation:
---
**Original Content Snippet:**
{original_text[:6000]}

**Study Notes Snippet:**
{notes[:6000]}
---

{'EXISTING QUESTIONS (Avoid generating identical or near-identical questions):' + json.dumps(existing_question_texts[:15], indent=2) if existing_question_texts else "No existing questions provided."}
---

**Task:** Generate a high-quality quiz in English with exactly {num_questions} questions based **strictly and solely** on the provided Context snippets (Original Content and Study Notes). Do not use any external knowledge.

**Quiz Requirements:**
1.  **Question Types:** {question_types_instruction}
2.  **Difficulty Level:** Target the '{difficulty}' level of Bloom's Taxonomy. Brief guide:
    *   Remember: Recall facts, terms, basic concepts.
    *   Understand: Explain ideas or concepts, summarize, interpret.
    *   Apply: Use information in a new situation (e.g., solve a problem based on principles in the text).
    *   Analyze: Break down information, identify patterns, relationships, causes.
    *   Evaluate: Justify a stance or decision, critique, compare/contrast based *on the text*.
    *   Create: Produce new or original work (Less common for auto-generated quizzes from text, usually requires specific instructions).
3.  **Context Grounding:** **Crucially, all questions and correct answers must be directly derivable from the provided Context snippets.** Avoid ambiguity.
4.  **Concept Coverage:** Aim to cover **different key concepts, topics, or sections** present within the provided context, rather than focusing too narrowly on one part.
5.  **Clarity:** Phrasing must be clear, concise, and unambiguous. Avoid overly complex sentence structures or jargon not present in the context. Avoid confusing negative questions (e.g., "Which is NOT... except...").

**Quality Guidelines for Specific Question Types:**
*   **MCQ (Multiple Choice):**
    *   The correct answer must be unequivocally supported by the context.
    *   Distractors (incorrect options) MUST be **plausible** and **relevant** to the topic based on the context.
    *   Good distractors often reflect common misconceptions mentioned or implied in the text, subtle distinctions, or related but incorrect concepts found within the context.
    *   Avoid obviously wrong, nonsensical, or unrelated distractors.
    *   All options should be grammatically consistent with the question stem.
*   **Matching:**
    *   Ensure items in Column A and Column B represent **meaningful, distinct concepts or terms** from the context.
    *   The pairings should test understanding of relationships (e.g., term-definition, cause-effect, concept-example) drawn **from the text**.
    *   Ensure Column B items are shuffled relative to Column A. Exactly 5 items per column.
*   **Fill_in_the_Blank:** The blank should represent a **key term or concept** from the context. The provided correct answer should be precise.
*   **Short_Answer:** The question should prompt a concise answer that requires synthesizing information **from the context**. The ideal answer provided should reflect this.
*   **True/False:** The statement must be clearly verifiable as either true or false **based entirely on the provided context.**

**Explanation Quality:**
*   For **all** question types, the `explanation` field is mandatory.
*   It must clearly justify the correct answer by referencing *specific information or logic found within the provided context snippets*.
*   For **MCQ**, the explanation should also briefly address **why the most plausible distractors are incorrect**, again referencing the context.

**Output Format (Strict Adherence Required):**
*   Provide the output as a single, valid JSON array `[...]` containing exactly {num_questions} question objects.
*   Each question object MUST follow this precise structure and use these exact keys:
    ```json
    {{
      "type": "...", // String: "MCQ", "True/False", "Fill_in_the_Blank", "Matching", "Short_Answer"
      "question": "...", // String: Question text. DO NOT include difficulty level prefix like '[Analyze]'.
      "options": ..., // Type depends on "type":
                     //   - MCQ: Array of 4 Strings. ["Option A", "Option B", "Option C", "Option D"]
                     //   - True/False: Array of 2 Strings. Must be exactly ["True", "False"]
                     //   - Fill_in_the_Blank: Empty Array. []
                     //   - Matching: Object with two keys: "column_a" (Array of 5 Strings) and "column_b" (Array of 5 Strings, shuffled).
                     //   - Short_Answer: Empty Array. []
      "correct_answer": ..., // Type depends on "type":
                             //   - MCQ: String (Exact text of the correct option from "options")
                             //   - True/False: String ("True" or "False")
                             //   - Fill_in_the_Blank: String or Array of Strings (Acceptable answers)
                             //   - Matching: Array of 5 Strings, each mapping "A_index-B_index" (e.g., ["0-3", "1-0", "2-4", "3-1", "4-2"])
                             //   - Short_Answer: String (Ideal concise answer for evaluation reference)
      "explanation": "...", // String: Detailed justification referencing the context. For MCQ, explain why key distractors are wrong.
      "difficulty": "..." // String: The target Bloom's level requested (e.g., "{difficulty}")
    }}
    ```
*   **Crucial:** Ensure all strings within the JSON are properly escaped (e.g., `\\\\` for backslashes, `\"` for quotes). Double-check JSON validity.
*   **ABSOLUTELY NO text outside the main JSON array `[...]`. No ```json``` markers, no comments, no introductory sentences.** Start with `[` and end with `]`.

Example MCQ Object (Reflecting Enhanced Guidelines):
```json
{{
  "type": "MCQ",
  "question": "According to the provided text on photosynthesis, if a plant's stomata are forced closed for an extended period, which input reactant would become limiting first?",
  "options": [
    "Water (H2O) absorbed by the roots.",
    "Sunlight energy captured by chlorophyll.",
    "Carbon Dioxide (CO2) from the atmosphere.",
    "Oxygen (O2) produced during the light reactions."
  ],
  "correct_answer": "Carbon Dioxide (CO2) from the atmosphere.",
  "explanation": "The context states that stomata are pores primarily responsible for gas exchange, allowing CO2 uptake. If closed, CO2 cannot enter the leaf, directly limiting the Calvin cycle (carbon fixation). While water (Option A) is crucial, it's absorbed by roots. Sunlight (Option B) is energy, not a reactant entering via stomata. Oxygen (Option D) is a product, not an input reactant limited by closed stomata according to the text.",
  "difficulty": "Analyze"
}}
```
"""
    try:
        # Use a model suitable for complex instruction following
        quiz_model = genai.GenerativeModel(DEFAULT_GEMINI_MODEL)
        quiz_response = quiz_model.generate_content(quiz_prompt)

        # Robust response handling (keep existing logic)
        response_text = ""
        if quiz_response.candidates and quiz_response.candidates[0].content and quiz_response.candidates[0].content.parts:
            response_text = quiz_response.candidates[0].content.parts[0].text
            finish_reason = quiz_response.candidates[0].finish_reason
            if finish_reason != 1: # STOP
                print(f"Warning: Quiz generation may be incomplete. Finish Reason: {finish_reason}")
                safety_ratings = getattr(quiz_response.candidates[0], 'safety_ratings', None)
                if safety_ratings and any(r.probability >= 3 for r in safety_ratings): # HIGH/MEDIUM
                    return {"error": f"Quiz generation potentially blocked or truncated due to safety concerns (Finish Reason: {finish_reason})."}

        elif hasattr(quiz_response, 'prompt_feedback') and quiz_response.prompt_feedback.block_reason:
            print(f"Quiz generation blocked. Reason: {quiz_response.prompt_feedback.block_reason}")
            return {"error": f"Quiz generation failed due to prompt block: {quiz_response.prompt_feedback.block_reason}"}
        else:
            try:
                response_text = quiz_response.text # Fallback
            except AttributeError:
                print("Critical: Could not extract text from quiz generation response.")
                print(f"Full quiz response object: {quiz_response}")
                return {"error": "Failed to generate quiz: No valid response text found."}

        # Clean and parse JSON (keep existing logic)
        cleaned_text = response_text.strip()
        if cleaned_text.startswith("```json"):
            cleaned_text = cleaned_text[7:]
        if cleaned_text.endswith("```"):
            cleaned_text = cleaned_text[:-3]
        cleaned_text = cleaned_text.strip()

        # Validate JSON structure before returning (keep existing logic)
        try:
            questions = json.loads(cleaned_text)
            if not isinstance(questions, list):
                if isinstance(questions, dict) and 'type' in questions: # Allow single object response
                    print("Warning: Received single question object, wrapping in list.")
                    questions = [questions]
                else:
                    raise ValueError("Generated response is not a JSON list of question objects.")

            for q_idx, q in enumerate(questions):
                if not isinstance(q, dict) or not all(k in q for k in ['type', 'question', 'options', 'correct_answer', 'explanation', 'difficulty']):
                     required_keys = ['type', 'question', 'correct_answer', 'explanation', 'difficulty']
                     if not all(k in q for k in required_keys):
                         raise ValueError(f"Missing key fields in question object at index {q_idx}: {str(q)[:100]}...")
                     if 'options' not in q:
                          if q['type'] in ['Fill_in_the_Blank', 'Short_Answer']:
                              q['options'] = []
                          else:
                              raise ValueError(f"Missing 'options' key for question type {q['type']} at index {q_idx}")

                q_type = q.get('type')
                options = q.get('options')
                correct_answer = q.get('correct_answer')

                if q_type == "MCQ":
                    if not isinstance(options, list) or not (len(options) == 4):
                        raise ValueError(f"Invalid 'options' format/count for MCQ at index {q_idx}. Expected array of 4 strings.")
                    if not isinstance(correct_answer, str) or correct_answer not in options:
                         raise ValueError(f"Invalid 'correct_answer' for MCQ at index {q_idx}. Must match one of the options.")
                elif q_type == "True/False":
                     if not isinstance(options, list) or options != ["True", "False"]:
                         raise ValueError(f"Invalid 'options' for True/False at index {q_idx}. Expected ['True', 'False'].")
                     if correct_answer not in ["True", "False"]:
                          raise ValueError(f"Invalid 'correct_answer' for True/False at index {q_idx}.")
                elif q_type == "Fill_in_the_Blank":
                     if not isinstance(options, list) or options != []:
                          raise ValueError(f"Invalid 'options' for Fill_in_the_Blank at index {q_idx}. Expected [].")
                     if not isinstance(correct_answer, (str, list)):
                          raise ValueError(f"Invalid 'correct_answer' for Fill_in_the_Blank at index {q_idx}.")
                elif q_type == "Short_Answer":
                      if not isinstance(options, list) or options != []:
                          raise ValueError(f"Invalid 'options' for Short_Answer at index {q_idx}. Expected [].")
                      if not isinstance(correct_answer, str):
                           raise ValueError(f"Invalid 'correct_answer' for Short_Answer at index {q_idx}. Expected string.")
                elif q_type == "Matching":
                    if not isinstance(options, dict) or \
                       not isinstance(options.get('column_a'), list) or len(options['column_a']) != 5 or \
                       not isinstance(options.get('column_b'), list) or len(options['column_b']) != 5:
                        raise ValueError(f"Invalid 'options' format/count for Matching at index {q_idx}. Expected object with column_a/b arrays of 5 strings.")
                    if not isinstance(correct_answer, list) or len(correct_answer) != 5 or \
                       not all(re.match(r'^\d+-\d+$', item) for item in correct_answer):
                        raise ValueError(f"Invalid 'correct_answer' format/count for Matching at index {q_idx}. Expected array of 5 'X-Y' strings.")

            quiz_id = str(uuid.uuid4())
            return {
                "quiz_id": quiz_id,
                "questions": questions,
                "status": "success"
            }
        except json.JSONDecodeError as e:
            print(f"Error parsing generated quiz JSON: {e}")
            error_context = cleaned_text[max(0, e.pos - 40):min(len(cleaned_text), e.pos + 40)]
            print(f"Error near position {e.pos}: ...{error_context}...")
            print(f"Received text: {cleaned_text}")
            return {"error": f"Failed to parse quiz JSON: {e}. Error near: '{error_context}'. Please try generating again."}
        except ValueError as e:
            print(f"Error validating quiz structure: {e}")
            print(f"Received data: {cleaned_text}")
            return {"error": f"Generated quiz data has incorrect structure: {e}"}

    except Exception as e:
        print(f"Error generating quiz with Gemini: {str(e)}")
        if "429" in str(e) or "Resource has been exhausted" in str(e):
            return {"error": "Rate limit or quota exceeded during quiz generation."}
        if "block_reason: SAFETY" in str(e):
            return {"error": "Quiz generation was blocked due to safety filters. Try adjusting the topic or description."}
        return {"error": f"Failed to generate quiz: {str(e)}"}


def generate_flashcards(notes, original_text, existing_flashcards_json="[]", num_flashcards=10):
    """Generate flashcards based on provided text and notes, ensuring JSON-safe LaTeX."""
    if not notes and not original_text:
        return {"error": "Cannot generate flashcards without notes or original text."}

    # Limit context size (keep existing logic)
    flashcard_context = f"**Study Notes Snippet:**\n{notes[:10000]}\n\n**Original Text Snippet:**\n{original_text[:10000]}"
    if len(notes) > 10000 or len(original_text) > 10000:
        flashcard_context += "\n\n[... Content truncated for flashcard generation prompt ...]"

    existing_cards = []
    try:
        parsed_existing = json.loads(existing_flashcards_json)
        if isinstance(parsed_existing, list):
            existing_cards = parsed_existing
    except json.JSONDecodeError:
        print("Warning: Could not parse existing flashcards JSON.")

    existing_card_questions = [
        card.get('question', '') for card in existing_cards
        if card is not None and isinstance(card, dict) and card.get('question')
    ]

    # --- Refined Prompt (Again, emphasizing correct escaping) ---
    flashcard_prompt = f"""
Context for Flashcard Generation:
---
**Original Content Snippet:**
{original_text[:5000]}

**Study Notes Snippet:**
{flashcard_context[:5000]}
---

EXISTING FLASHCARD QUESTIONS (Avoid generating identical questions):
---
{json.dumps(existing_card_questions, indent=2) if existing_card_questions else "No existing flashcards to avoid."}
---

Instructions:
Generate exactly {num_flashcards} flashcards in English based *strictly* on the provided Context.
Each flashcard should focus on a single, specific concept, definition, term, key fact, or relationship from the context.
Aim for a mix of key terms and conceptual questions.

For EACH flashcard, provide a JSON object with the following precise structure:
{{
    "question": "Clear question text...",
    "answer": "Concise and accurate answer text..."
}}

**ULTRA-CRITICAL JSON & LaTeX Escaping Rules:**
1.  The *entire* output MUST be a single, valid JSON array `[...]` containing the {num_flashcards} flashcard objects.
2.  Within the JSON strings (especially the "answer"), if you include standard LaTeX math:
    *   Every literal backslash `\\` required by LaTeX (e.g., for commands like `\\frac`, `\\int`, `\\sin`, `\\alpha`, or for line breaks `\\\\`) MUST be represented as a *double backslash* `\\\\` in the JSON string.
    *   Example LaTeX `$f(x) = \\frac{{1}}{{x}}$` becomes JSON `"answer": "$f(x) = \\\\frac{{1}}{{x}}$"`.
    *   Example LaTeX `$\\alpha$` becomes JSON `"answer": "$\\\\alpha$"`.
    *   Example LaTeX `$\\sin(x)$` becomes JSON `"answer": "$\\\\sin(x)$"`.
    *   Example LaTeX `A \\\\ B` (line break) becomes JSON `"answer": "A \\\\\\\\ B"`.
3.  Ensure all standard JSON string characters are escaped correctly (e.g., `\"` for a quote within the string, `\\n` for a newline character if needed, etc.).
4.  **DO NOT** add extra backslashes where LaTeX doesn't need them (e.g., do not write `\\\\sin` if LaTeX just needs `\\sin`). Only double the ones that LaTeX actually uses.

Output Format Reminder:
Return ONLY the valid JSON array `[...]`. Do not include ```json``` markers or any text outside the JSON array. Start with `[` and end with `]`.
"""
    # --- End Refined Prompt ---

    try:
        flashcard_model = genai.GenerativeModel(DEFAULT_GEMINI_MODEL)
        flashcard_response = flashcard_model.generate_content(flashcard_prompt)

        # Robust response handling (keep as is)
        response_text = ""
        # ... (keep existing response extraction logic) ...
        if flashcard_response.candidates and flashcard_response.candidates[0].content and flashcard_response.candidates[0].content.parts:
            response_text = flashcard_response.candidates[0].content.parts[0].text
            finish_reason = flashcard_response.candidates[0].finish_reason
            if finish_reason != 1: # STOP
                 print(f"Warning: Flashcard generation may be incomplete. Finish Reason: {finish_reason}")
                 safety_ratings = getattr(flashcard_response.candidates[0], 'safety_ratings', None)
                 if safety_ratings and any(r.probability >= 3 for r in safety_ratings): # HIGH/MEDIUM
                      return {"error": f"Flashcard generation potentially blocked or truncated due to safety concerns (Finish Reason: {finish_reason})."}
        elif hasattr(flashcard_response, 'prompt_feedback') and flashcard_response.prompt_feedback.block_reason:
            print(f"Flashcard generation blocked. Reason: {flashcard_response.prompt_feedback.block_reason}")
            return {"error": f"Flashcard generation failed due to prompt block: {flashcard_response.prompt_feedback.block_reason}"}
        else:
            try: response_text = flashcard_response.text # Fallback
            except AttributeError:
                 print("Critical: Could not extract text from flashcard generation response.")
                 print(f"Full flashcard response object: {flashcard_response}")
                 return {"error": "Failed to generate flashcards: No valid response text found."}


        # Clean markdown fences (keep as is)
        cleaned_text = response_text.strip()
        if cleaned_text.startswith("```json"): cleaned_text = cleaned_text[7:]
        if cleaned_text.endswith("```"): cleaned_text = cleaned_text[:-3]
        cleaned_text = cleaned_text.strip()

        # --- ADDED: Pre-parsing Regex Fix for common LaTeX escape issues ---
        try:
            # Attempt to fix single backslashes that should be doubled for JSON
            # Looks for a single backslash followed by common LaTeX command chars or {, }, ^, _
            # Important: Use raw string (r'...') for regex pattern
            # Exclude cases where it's already correctly doubled (\\\\) or part of a JSON escape (\", \n, etc.)
            fixed_text = re.sub(r'(?<!\\)\\(?!["\\/bfnrtu])([a-zA-Z{}()^_*])', r'\\\\\\1', cleaned_text)

            # Optional: Fix cases where the model might have over-escaped simple math chars
            # fixed_text = re.sub(r'\\\\([+*/-])', r'\\1', fixed_text) # Uncomment carefully if needed

            if fixed_text != cleaned_text:
                print("Applied pre-parsing regex fix for LaTeX escapes.")
                # print(f"Original: ...{cleaned_text[max(0, e.pos-40):min(len(cleaned_text), e.pos+40)]}...") # Debug
                # print(f"Fixed   : ...{fixed_text[max(0, e.pos-40):min(len(fixed_text), e.pos+40)]}...") # Debug
                cleaned_text = fixed_text # Use the fixed text for parsing
        except Exception as regex_error:
            print(f"Warning: Regex fix for LaTeX escapes failed: {regex_error}")
            # Proceed with original cleaned_text if regex fails

        # --- END ADDED Regex Fix ---


        # Parse JSON (keep existing logic)
        try:
            flashcards = json.loads(cleaned_text)
            if not isinstance(flashcards, list): raise ValueError("Generated response is not a JSON list.")
            # ... (keep existing validation logic) ...
            for card in flashcards:
                 if not isinstance(card, dict) or 'question' not in card or 'answer' not in card:
                     if card is None: raise ValueError("Invalid flashcard object structure: encountered None value.")
                     raise ValueError(f"Invalid flashcard object structure in: {card}")

            flashcard_id = str(uuid.uuid4()) # Generate temporary ID
            return {
                "flashcard_id": flashcard_id,
                "flashcards": flashcards,
                "status": "success"
            }
        except json.JSONDecodeError as e:
            print(f"Error parsing generated flashcards JSON: {e}")
            print(f"Received text snippet (after potential regex fix): {cleaned_text[:500]}...")
            error_context = cleaned_text[max(0, e.pos - 40):min(len(cleaned_text), e.pos + 40)]
            return {"error": f"Failed to parse flashcards JSON: {e}. Check for invalid characters/escapes near '{error_context}'. Please try generating again."}
        # ... (keep existing exception handlers) ...
        except ValueError as e:
             print(f"Error validating flashcard structure: {e}")
             print(f"Received data: {cleaned_text}")
             return {"error": f"Generated flashcard data has incorrect structure: {e}"}

    except Exception as e:
        print(f"Error generating flashcards with Gemini: {str(e)}")
        if "429" in str(e): return {"error": "Rate limit exceeded during flashcard generation."}
        if "block_reason: SAFETY" in str(e):
             return {"error": "Flashcard generation was blocked due to safety filters."}
        return {"error": f"Failed to generate flashcards: {str(e)}"}

# --- Place this modified function in app.py (replaces the old one) ---
# Ensure necessary imports like `genai`, `re`, and helper functions are available

def chat_with_content(notes, original_text, chat_history, user_message, web_search_enabled):
    """Handles chat interaction based on notes, original text, and history using generate_content."""
    if not notes and not original_text:
        # If there's no context, it essentially becomes a general chatbot
        print("Warning: Chatting without notes or original text. Operating in general mode.")
        # We can proceed, but the system prompt needs to reflect this lack of context.

    # Basic validation of chat history format (Keep existing validation)
    if not isinstance(chat_history, list):
        print("Warning: Invalid chat history format received. Starting fresh.")
        chat_history = []
    else:
        # Ensure history has the correct structure {role: str, parts: list[str | Part]}
        valid_history = []
        for msg in chat_history:
            if isinstance(msg, dict) and 'role' in msg and 'parts' in msg and isinstance(msg['parts'], list):
                 # Simplified check: assume parts contain text
                 if all(isinstance(part, str) for part in msg['parts']):
                    valid_history.append(msg)
                 # Handle cases where parts might be [{'text': '...'}]
                 elif len(msg['parts']) == 1 and isinstance(msg['parts'][0], dict) and 'text' in msg['parts'][0]:
                     valid_history.append({'role': msg['role'], 'parts': [msg['parts'][0]['text']]})
                 else:
                    print(f"Warning: Skipping chat history message with unexpected parts format: {msg}")
            else:
                 print(f"Warning: Skipping invalid chat history message: {msg}")
        chat_history = valid_history

    # Prepare context snippets for the chat model
    chat_notes_snippet = notes[:8000] if notes else ""
    chat_original_text_snippet = original_text[:8000] if original_text else ""
    context_truncated_warning = ""
    if (notes and len(notes) > 8000) or (original_text and len(original_text) > 8000):
        context_truncated_warning = "\n[Note: Provided study material snippets may be truncated for brevity in this context.]"

    # --- Optional Web Search for Chat (Keep existing logic) ---
    web_context_for_prompt = ""
    web_sources_list = []
    # Only perform web search if context exists and search is enabled
    if (chat_notes_snippet or chat_original_text_snippet) and web_search_enabled and SEARCH_ENGINE_ID:
        print("Chat: Web search enabled. Generating queries...")
        try:
            query_context = f"User question: {user_message}\n\nRelevant notes context:\n{chat_notes_snippet[:1000]}"
            search_queries = generate_search_queries(query_context, num_queries=2) # generate_search_queries defined elsewhere
            print(f"Chat search queries: {search_queries}")

            if search_queries:
                web_context_for_prompt += "\n\n--- Relevant Web Search Results for Current Question ---\n"
                source_counter = 1
                processed_urls = set()
                for query in search_queries:
                    print(f"Chat searching for: '{query}'")
                    urls_data = search_web(query, num_results=1) # search_web defined elsewhere
                    for url_data in urls_data:
                        url = url_data['link']
                        if url in processed_urls: continue
                        print(f"Chat fetching: {url}")
                        content = fetch_page_content(url) # fetch_page_content defined elsewhere
                        processed_urls.add(url)
                        if content:
                            source_ref = f"Web Source {source_counter}"
                            web_sources_list.append({"ref": source_ref, "url": url})
                            web_context_for_prompt += f"\n[{source_ref}]\nURL: {url}\nContent Summary:\n{content[:1000]}...\n"
                            source_counter += 1
                            if len(web_context_for_prompt) > 5000: break
                    if len(web_context_for_prompt) > 5000: break

                if web_sources_list:
                    web_context_for_prompt += "\nWhen using info *only* from these web results, cite [Web Source X]."
        except Exception as e:
            print(f"Error during chat web search: {str(e)}")
            web_context_for_prompt = "\n[Note: Web search for this question failed.]"
    # --- End Web Search ---

    # --- MODIFIED System Instruction ---
    # Construct the System Instruction based on whether context exists
    if chat_notes_snippet or chat_original_text_snippet:
        system_instruction = f"""You are a helpful study assistant. Your primary goal is to help the user understand the provided study material.

--- Start of Study Material Snippets ---
**Study Notes Snippet:**
{chat_notes_snippet}

**Original Text Snippet:**
{chat_original_text_snippet}
{context_truncated_warning}
--- End of Study Material Snippets ---

{web_context_for_prompt if web_context_for_prompt else "[No relevant web search results provided for this question.]"}
---

**Instructions:**
1.  **Prioritize Context:** Answer the user's questions based **first and foremost** on the provided **Study Material Snippets** and **Web Search Results** above whenever the question relates to this content. Analyze the user's question to see if it relates to the provided material.
2.  **Cite Web Sources:** If using information found *only* in the Web Search Results, incorporate it and clearly cite it using the [Web Source X] format.
3.  **Acknowledge Context Limitations:** If the question *relates* to the study material but the answer *cannot be found* within the provided snippets or web results, state that you cannot find the answer within the given context.
4.  **General Knowledge Fallback:** If the user's question is **clearly unrelated** to the provided study material context (e.g., asking "What is the capital of France?" when the context is about programming), you **MAY** answer using your general knowledge.
5.  **Disclose Source:** When answering using general knowledge (fallback), **you MUST explicitly state** that the information comes from your general knowledge and not from the provided documents (e.g., "Based on my general knowledge, ...").
6.  **Be Concise and Helpful:** Use Markdown for formatting.
7.  **Stay Focused:** Preferentially discuss the study material unless the user clearly shifts to unrelated general knowledge questions. Do not proactively offer unrelated information.
"""
    else:
        # Simplified instruction if no context was provided
        system_instruction = """You are a helpful general assistant. Answer the user's questions clearly and concisely using your general knowledge. Use Markdown for formatting."""

    # --- End MODIFIED System Instruction ---


    # Prepare history for the API call (Keep existing logic)
    max_history_turns = 10
    truncated_history = chat_history[-(max_history_turns * 2):]
    current_turn_user_message_api_format = {"role": "user", "parts": [user_message]}
    full_history_for_api = truncated_history + [current_turn_user_message_api_format]


    try:
        # Use generate_content with system instruction and history (Keep existing logic)
        chat_model = genai.GenerativeModel(
            model_name=DEFAULT_GEMINI_MODEL, # Or your chosen model
            system_instruction=system_instruction
        )

        print(f"Sending chat request to generate_content. History length: {len(full_history_for_api)}")
        # print(f"System Instruction Snippet: {system_instruction[:500]}...") # Debug log more context

        response = chat_model.generate_content(
            contents=full_history_for_api,
            generation_config=genai.types.GenerationConfig(
                temperature=0.7 # Adjust as needed
            ),
             # safety_settings=[...] # Optional
        )

        # Robust response handling (Keep existing logic)
        assistant_response_text = ""
        # ... (Keep the response extraction logic from the previous version) ...
        if response.candidates and response.candidates[0].content and response.candidates[0].content.parts:
             assistant_response_text = response.candidates[0].content.parts[0].text
             finish_reason = getattr(response.candidates[0], 'finish_reason', None)
             if finish_reason and finish_reason != 1: # 1 = STOP
                  print(f"Warning: Chat response generation may be incomplete. Finish Reason: {finish_reason}")
                  safety_ratings = getattr(response.candidates[0], 'safety_ratings', [])
                  if any(hasattr(r, 'probability') and r.probability >= 3 for r in safety_ratings):
                     assistant_response_text += "\n\n[Response may be incomplete due to safety filtering.]"
                  elif finish_reason == 3:
                      assistant_response_text += "\n\n[Response may be incomplete due to length limitations.]"
        elif hasattr(response, 'prompt_feedback') and getattr(response.prompt_feedback, 'block_reason', None):
            block_reason = response.prompt_feedback.block_reason
            print(f"Chat prompt blocked. Reason: {block_reason}")
            return {"error": f"Chat failed due to prompt block: {block_reason}."}
        else:
             try: assistant_response_text = response.text
             except AttributeError:
                 print("Critical: Could not extract text from chat response using standard attributes or .text fallback.")
                 print(f"Full chat response object structure (logging first 500 chars): {str(response)[:500]}...")
                 if hasattr(response, 'error'): return {"error": f"Chat failed: API returned error - {response.error}"}
                 return {"error": "Chat failed: Could not extract valid response text from API."}

        if not assistant_response_text:
            assistant_response_text = "[The assistant did not generate a response for this turn.]"
            print("Warning: Assistant response text is empty after processing.")

        # Append user message AND assistant response to the original chat_history state variable (Keep existing logic)
        assistant_response_api_format = {"role": "model", "parts": [assistant_response_text]}
        updated_history = chat_history + [current_turn_user_message_api_format, assistant_response_api_format]

        # Append source links to the response text if they were used/cited (Keep existing logic)
        if web_sources_list:
             cited_refs = re.findall(r'\[Web Source (\d+)\]', assistant_response_text)
             if cited_refs:
                 links_to_append = "\n\n**Referenced Web Sources:**\n"
                 added_links = set()
                 for ref_num_str in cited_refs:
                      try:
                          ref_num = int(ref_num_str)
                          if 1 <= ref_num <= len(web_sources_list) and ref_num not in added_links:
                              source_info = web_sources_list[ref_num - 1]
                              links_to_append += f"*   [{source_info['ref']}] {source_info['url']}\n"
                              added_links.add(ref_num)
                      except (ValueError, IndexError) as link_err:
                           print(f"Warning: Could not process citation reference '[Web Source {ref_num_str}]': {link_err}")
                 if added_links:
                    assistant_response_text += links_to_append


        return {
            "response": assistant_response_text,
            "history": updated_history[-(max_history_turns * 2):], # Return truncated history
            "status": "success"
        }

    except Exception as e:
        # Keep existing exception handling logic
        print(f"Error during chat interaction: {str(e)}")
        import traceback
        traceback.print_exc()
        error_str = str(e).lower()
        if "429" in error_str or "quota" in error_str or "resource has been exhausted" in error_str: return {"error": "Rate limit or quota exceeded during chat. Please try again later."}
        elif "system_instruction" in error_str: return {"error": "There was an issue setting up the chat context with the AI model. Please try again."}
        elif "safety" in error_str or "blocked" in error_str: return {"error": "Chat request blocked due to safety settings or content policy."}
        elif "api key not valid" in error_str: return {"error": "Invalid API Key. Please check configuration."}
        elif "deadline exceeded" in error_str or "timeout" in error_str: return {"error": "The request timed out while waiting for the AI. Please try again."}
        return {"error": f"Failed to get chat response: An unexpected server error occurred ({type(e).__name__})."}


def evaluate_subjective_answer(question, ideal_answer, user_answer, notes_context):
    """Uses Gemini to evaluate a user's short/long answer."""

    eval_prompt = f"""
Context: The user was asked the following question based on some study material:
Question: {question}

Ideal Answer/Key Points (derived from study material): {ideal_answer}

User's Answer: {user_answer}

Relevant Study Notes Snippet (for context):
---
{notes_context[:5000]}
---

Task: Evaluate the user's answer based on the question and the ideal answer/key points derived from the study notes.

Evaluation Criteria:
1.  **Accuracy:** Does the user's answer correctly address the question based on the study material context?
2.  **Completeness:** Does the user's answer include the key points expected (as outlined in the ideal answer)?
3.  **Clarity:** Is the user's answer clear and understandable?

Output: Provide your evaluation ONLY as a JSON object with the following structure:
{{
    "score": <integer score from 0 to 10>,
    "feedback": "<string containing constructive feedback for the user>"
}}

Scoring Guide:
- 0: Completely incorrect or irrelevant.
- 1-3: Shows minimal understanding, mostly incorrect or missing key points.
- 4-6: Partially correct, addresses some aspects but misses significant points or contains inaccuracies.
- 7-8: Mostly correct and complete, minor inaccuracies or omissions allowed.
- 9: Correct, complete, and clear. Excellent understanding.
- 10: Perfect answer, potentially showing deeper insight beyond basic recall (if applicable).

Feedback Guide: Be specific. Explain *why* the score was given. Point out correct parts, missing elements, and inaccuracies, referencing the study notes context or ideal answer. Keep feedback concise and helpful for learning.

Example Output:
```json
{{
  "score": 7,
  "feedback": "Your answer correctly identifies the main function but misses mentioning the specific inputs (CO2 and water) mentioned in the notes. It's clear and accurate otherwise."
}}
```

Return ONLY the JSON object.
"""
    try:
        eval_model = genai.GenerativeModel(DEFAULT_GEMINI_MODEL) # Use a capable model
        eval_response = eval_model.generate_content(eval_prompt)

        # Robust response handling
        response_text = ""
        if eval_response.candidates and eval_response.candidates[0].content and eval_response.candidates[0].content.parts:
            response_text = eval_response.candidates[0].content.parts[0].text
        else:
             try: response_text = eval_response.text
             except AttributeError: return {"error": "Evaluation failed: No response text."}

        # Clean and parse JSON
        cleaned_text = response_text.strip()
        if cleaned_text.startswith("```json"): cleaned_text = cleaned_text[7:]
        if cleaned_text.endswith("```"): cleaned_text = cleaned_text[:-3]
        cleaned_text = cleaned_text.strip()

        try:
            evaluation = json.loads(cleaned_text)
            if not isinstance(evaluation, dict) or 'score' not in evaluation or 'feedback' not in evaluation:
                raise ValueError("Invalid evaluation object structure.")
            # Add validation for score range if needed
            if not (isinstance(evaluation['score'], int) and 0 <= evaluation['score'] <= 10):
                 print(f"Warning: Evaluation score {evaluation['score']} out of range 0-10. Clamping.")
                 evaluation['score'] = max(0, min(10, int(evaluation['score']))) # Clamp score

            evaluation["status"] = "success"
            return evaluation

        except (json.JSONDecodeError, ValueError) as e:
            print(f"Error parsing/validating evaluation JSON: {e}")
            print(f"Received text: {cleaned_text}")
            return {"error": f"Failed to parse evaluation result. Invalid format: {e}"}

    except Exception as e:
        print(f"Error during subjective evaluation: {str(e)}")
        if "429" in str(e): return {"error": "Rate limit exceeded during evaluation."}
        return {"error": f"Failed to evaluate answer: {str(e)}"}


def generate_mindmap_data(notes, original_text):
    """Generates mind map data (Mermaid syntax) from notes."""
    if not notes and not original_text:
        return {"error": "Cannot generate mind map without notes or original text."}

    mindmap_context = f"**Study Notes:**\n{notes[:15000]}\n\n**Original Text Snippet:**\n{original_text[:15000]}"
    if len(notes) > 15000 or len(original_text) > 15000:
        mindmap_context += "\n\n[... Content truncated for mind map generation prompt ...]"

    mindmap_prompt = f"""
Context for Mind Map Generation:
---
{mindmap_context}
---

Task: Generate a mind map structure based on the key topics, sub-topics, concepts, and relationships found in the provided context.

Output Format: Use Mermaid flowchart syntax (LR - Left to Right preferred).

Guidelines:
1.  Identify the central topic. Use a clear, descriptive ID and label (e.g., `A["Central Topic"]`).
2.  Identify major sub-topics. Connect them from the central topic (e.g., `A --> B(Sub-Topic 1)`).
3.  Identify key concepts/terms within sub-topics. Connect them logically (e.g., `B --> B1["Concept 1.1"]`). Use different node shapes if appropriate (e.g., `()` for standard, `[]` for rectangle, `{{}}` for database, `(())` for circle).
4.  Use concise, meaningful labels for nodes. Keep IDs simple (e.g., A, B, B1, C1a).
5.  Represent relationships using arrows (`-->` for standard, `---` for no arrow, `-.->` for dotted, `==>` for thick). Add labels to arrows where useful (e.g., `A -- describes --> B`).
6.  Structure logically, reflecting the flow or hierarchy in the context.
7.  Aim for 15-50 nodes to capture the main structure without excessive detail.
8.  **Critical Syntax Rules:**
    *   The output MUST start *exactly* with `flowchart LR` or `graph LR` (or other valid direction like `TD`).
    *   The output MUST end *exactly* with the last node or link definition.
    *   **Do NOT include ```mermaid``` code fences.**
    *   **Do NOT include any comments (e.g., using `%%` or `%`).**
    *   Ensure node IDs are valid (alphanumeric, underscores).
    *   Ensure text labels within quotes (`""`) are properly handled if they contain special characters.
    *   Separate definitions/links with newlines or semicolons where appropriate according to Mermaid syntax.

Example Mermaid Syntax:
```mermaid
flowchart LR
    A["Central Topic: Photosynthesis"] --> B(Inputs);
    A --> C(Process);
    A --> D(Outputs);

    B --> B1["Sunlight (Energy)"];
    B --> B2["Water (H2O)"];
    B --> B3["Carbon Dioxide (CO2)"];

    C -- uses --> B1;
    C -- involves --> C1(Chloroplasts);
    C1 --> C1a(Chlorophyll);

    D --> D1["Glucose (Sugar C6H12O6)"];
    D --> D2["Oxygen (O2)"];
```

Generate ONLY the valid Mermaid syntax based on the context provided above.
"""
    try:
        # Use a model good at structured output
        mindmap_model = genai.GenerativeModel(DEFAULT_GEMINI_MODEL)
        mindmap_response = mindmap_model.generate_content(mindmap_prompt)

       # Robust response handling (keep existing logic)
        response_text = ""
        if mindmap_response.candidates and mindmap_response.candidates[0].content and mindmap_response.candidates[0].content.parts:
            response_text = mindmap_response.candidates[0].content.parts[0].text
            finish_reason = mindmap_response.candidates[0].finish_reason
            if finish_reason != 1: # STOP
                 print(f"Warning: Mind map generation may be incomplete. Finish Reason: {finish_reason}")
                 safety_ratings = getattr(mindmap_response.candidates[0], 'safety_ratings', None)
                 if safety_ratings and any(r.probability >= 3 for r in safety_ratings): # HIGH/MEDIUM
                      return {"error": f"Mind map generation blocked due to safety concerns (Finish Reason: {finish_reason})."}

        elif hasattr(mindmap_response, 'prompt_feedback') and mindmap_response.prompt_feedback.block_reason:
            print(f"Mind map generation blocked. Reason: {mindmap_response.prompt_feedback.block_reason}")
            return {"error": f"Mind map generation failed due to prompt block: {mindmap_response.prompt_feedback.block_reason}"}
        else:
            try:
                 response_text = mindmap_response.text # Fallback
            except AttributeError:
                 print("Critical: Could not extract text from mind map generation response.")
                 print(f"Full mind map response object: {mindmap_response}")
                 return {"error": "Failed to generate mind map: No valid response text found."}

        # Clean the response - remove potential ```mermaid``` markers and trim whitespace
        cleaned_syntax = response_text.strip()
        if cleaned_syntax.startswith("```mermaid"):
            cleaned_syntax = cleaned_syntax[10:] # Remove ```mermaid
        elif cleaned_syntax.startswith("```"):
             # Remove ``` optionally followed by language identifier like 'mermaid'
             cleaned_syntax = re.sub(r'^```(\s*mermaid)?\s*', '', cleaned_syntax)

        if cleaned_syntax.endswith("```"):
            cleaned_syntax = cleaned_syntax[:-3]

        cleaned_syntax = cleaned_syntax.strip()

        # Basic validation: check if it starts correctly and doesn't contain comments
        if not (cleaned_syntax.startswith("flowchart") or cleaned_syntax.startswith("graph")):
            print(f"Warning: Generated mind map syntax doesn't start as expected: {cleaned_syntax[:50]}...")
            # Allow it anyway, client-side Mermaid renderer will handle errors, but flag potential issue
        if '%%' in cleaned_syntax or '%' in cleaned_syntax.split('\n'): # Check for comments
             print(f"Warning: Generated mind map syntax may contain comments which are forbidden: {cleaned_syntax[:100]}...")

        return {
            "mindmap_syntax": cleaned_syntax,
            "status": "success"
        }

    except Exception as e:
        print(f"Error generating mind map data: {str(e)}")
        if "429" in str(e): return {"error": "Rate limit exceeded during mind map generation."}
        return {"error": f"Failed to generate mind map: {str(e)}"}

# --- API Routes (Stateless) ---
@app.route('/')
def index():
    # Pass API Key status to template (optional, for client-side checks/warnings)
    api_key_set = bool(os.environ.get("GOOGLE_API_KEY"))
    return render_template('index.html', api_key_set=api_key_set)

@app.route('/api/process-content', methods=['POST'])
def process_content_route():
    start_time = time.time()
    print("\n--- Received /api/process-content request ---")
    results = {}
    errors = []
    content_items = [] # Will store text dicts AND file upload result dicts
    uploaded_gemini_files_to_delete = [] # Keep track of successful uploads

    try:
        # --- 1. Extract Data from Request ---
        form_data = request.form
        uploaded_files = request.files.getlist('files') # FileStorage objects

        urls = json.loads(form_data.get('urls', '[]'))
        topic = form_data.get('topic', '').strip()
        description = form_data.get('description', '').strip()
        web_search = form_data.get('web_search', 'true').lower() == 'true'
        generate_quiz_initially = form_data.get('generate_quiz', 'false').lower() == 'true'
        generate_flashcards_initially = form_data.get('generate_flashcards', 'false').lower() == 'true'
        generate_mindmap_initially = form_data.get('generate_mindmap', 'false').lower() == 'true'

        print(f"URLs: {urls}")
        print(f"Files: {[f.filename for f in uploaded_files]}")
        print(f"Topic: '{topic}'")
        print(f"Description: '{description[:50]}...'")
        print(f"Web Search: {web_search}")
        print(f"Gen Quiz Initial: {generate_quiz_initially}")
        print(f"Gen Flashcards Initial: {generate_flashcards_initially}")
        print(f"Gen Mindmap Initial: {generate_mindmap_initially}")

        if not urls and not uploaded_files and not (topic and description):
            return jsonify({"error": "No input provided. Please add URLs, upload files, or enter a topic and description."}), 400

        # --- 2. Process URLs (Extract Text) ---
        print("Processing URLs...")
        for url in urls:
            url = url.strip()
            if not url: continue
            print(f"Processing URL: {url}")
            if 'youtube.com' in url or 'youtu.be' in url:
                content_data = extract_from_youtube(url) # Existing function
            else:
                content_data = extract_from_website(url) # Existing function

            if 'error' in content_data:
                print(f"Error processing URL {url}: {content_data['error']}")
                errors.append(f"URL '{url}': {content_data['error']}")
            else:
                 print(f"Success processing URL: {url} (Title: {content_data.get('title')})")
                 content_items.append(content_data) # Add text dict

        # --- 3. Process Files (Upload Only) ---
        print("Processing Files (Upload Step)...")
        if uploaded_files:
             for file_storage in uploaded_files:
                 if file_storage and file_storage.filename:
                     print(f"Uploading file: {file_storage.filename}")
                     # Use the new upload function
                     file_result = upload_file_to_gemini(file_storage)
                     if 'error' in file_result:
                         print(f"Error uploading file {file_storage.filename}: {file_result['error']}")
                         errors.append(f"File Upload '{file_storage.filename}': {file_result['error']}")
                     else:
                          print(f"Success uploading file: {file_storage.filename} (Gemini Name: {file_result['file_object'].name})")
                          content_items.append(file_result) # Add dict containing {'file_object': ..., 'original_filename': ...}
                          # Add the Gemini file name to the list for later deletion
                          uploaded_gemini_files_to_delete.append(file_result['file_object'].name)
                 else:
                     print("Empty file part received, skipping.")

        # --- 4. Check if *any* content can be processed ---
        # Check if content_items has *any* non-error items or if topic/desc exists
        has_processable_content = any('error' not in item for item in content_items) or (topic or description)
        if not has_processable_content:
             error_message = "Failed to retrieve or upload valid content from any source."
             print(error_message, "Errors:", errors)
             # Clean up any files that *did* upload successfully before failing others
             if uploaded_gemini_files_to_delete:
                 print(f"Cleaning up {len(uploaded_gemini_files_to_delete)} Gemini files due to overall content failure.")
                 for file_name in uploaded_gemini_files_to_delete:
                     try: genai_api.delete_file(file_name)
                     except Exception as del_err: print(f"Warning: Failed to delete Gemini file {file_name}: {del_err}")
             return jsonify({"error": error_message, "details": errors}), 400

        # --- 5. Generate Notes (Core Multimodal Processing) ---
        print("Generating Notes (Multimodal)...")
        notes_result = process_content(content_items, topic, description, web_search) # Pass the mixed list

        if 'error' in notes_result:
            print(f"Error generating notes: {notes_result['error']}")
            errors.append(f"Notes Generation: {notes_result['error']}")
            # Still try to clean up uploaded files even if notes fail
            return jsonify({"error": "Failed to generate study notes.", "details": errors}), 500
        else:
            print("Notes generated successfully.")
            results.update(notes_result)
            # Keep track of file names processed within notes_result if needed, though we already have them
            # file_names_processed_in_notes = notes_result.get("processed_file_names", [])

        # --- 6. Optionally Generate Quiz (Based on generated notes & original *text*) ---
        if generate_quiz_initially and results.get('notes'):
            print("Generating Initial Quiz...")
            quiz_result = generate_quizzes(
                notes=results['notes'],
                original_text=results.get('original_text', ''), # Use combined *text* input
                question_types=["MCQ"], # Example defaults
                num_questions=5,
                difficulty="Apply"
            )
            if 'error' in quiz_result:
                print(f"Error generating initial quiz: {quiz_result['error']}")
                errors.append(f"Initial Quiz Generation: {quiz_result['error']}")
            else:
                print("Initial quiz generated.")
                results['initial_quiz'] = quiz_result

        # --- 7. Optionally Generate Flashcards (Based on generated notes & original *text*) ---
        if generate_flashcards_initially and results.get('notes'):
            print("Generating Initial Flashcards...")
            flashcard_result = generate_flashcards(
                notes=results['notes'],
                original_text=results.get('original_text', ''), # Use combined *text* input
                num_flashcards=10 # Example default
            )
            if 'error' in flashcard_result:
                print(f"Error generating initial flashcards: {flashcard_result['error']}")
                errors.append(f"Initial Flashcard Generation: {flashcard_result['error']}")
            else:
                print("Initial flashcards generated.")
                results['initial_flashcards'] = flashcard_result

        # --- 8. Optionally Generate Mind Map (Based on generated notes & original *text*) ---
        if generate_mindmap_initially and results.get('notes'):
            print("Generating Initial Mind Map...")
            mindmap_result = generate_mindmap_data(
                notes=results['notes'],
                original_text=results.get('original_text', '') # Use combined *text* input
            )
            if 'error' in mindmap_result:
                print(f"Error generating initial mind map: {mindmap_result['error']}")
                errors.append(f"Initial Mind Map Generation: {mindmap_result['error']}")
            else:
                print("Initial mind map generated.")
                results['initial_mindmap'] = mindmap_result

        # --- 9. Final Response ---
        end_time = time.time()
        print(f"--- process-content finished in {end_time - start_time:.2f} seconds ---")

        final_response = {
            "data": results,
            "warnings": errors # Include non-fatal errors/warnings
        }
        return jsonify(final_response), 200

    except Exception as e:
        print(f"--- Unhandled exception in /api/process-content: {str(e)} ---")
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"An unexpected server error occurred: {str(e)}"}), 500

    finally:
        # --- Clean up successfully uploaded Gemini files ---
        if uploaded_gemini_files_to_delete:
            print(f"Cleaning up {len(uploaded_gemini_files_to_delete)} successfully processed Gemini files...")
            for file_name in uploaded_gemini_files_to_delete:
                try:
                    genai_api.delete_file(file_name)
                    print(f"Deleted Gemini file: {file_name}")
                except Exception as delete_error:
                    # Log but don't fail the request
                    print(f"Warning: Failed to delete Gemini file {file_name}: {delete_error}")

# --- Routes for Generating Features On-Demand ---

@app.route('/api/generate-quizzes', methods=['POST'])
def generate_quizzes_route():
    print("Received /api/generate-quizzes request")
    data = request.json
    notes = data.get('notes')
    original_text = data.get('original_text')
    # Existing questions are less relevant if replacing, but backend handles it
    existing_questions = data.get('existing_questions', '[]')
    question_types = data.get('question_types', ["MCQ"])
    num_questions = data.get('num_questions', 5)
    difficulty = data.get('difficulty', 'Apply') # Get difficulty level

    if not notes and not original_text:
        return jsonify({"error": "Missing notes or original_text"}), 400
    if not isinstance(question_types, list) or not question_types:
         return jsonify({"error": "Invalid or missing question_types list"}), 400
    if difficulty not in ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"]:
         print(f"Warning: Invalid difficulty '{difficulty}' received, defaulting to Apply.")
         difficulty = "Apply"

    # Pass the difficulty to the generation function
    result = generate_quizzes(notes, original_text, existing_questions, question_types, num_questions, difficulty)
    if 'error' in result:
        # Return 500 for server-side errors, 400 for specific known issues like safety blocks
        status_code = 500
        if "safety" in result.get("error", "").lower() or "prompt block" in result.get("error", "").lower():
            status_code = 400
        elif "parse quiz json" in result.get("error","").lower() or "incorrect structure" in result.get("error","").lower():
            status_code = 500 # Internal error likely from LLM structure
        return jsonify(result), status_code
    print("Quiz generation successful.")
    return jsonify(result), 200

@app.route('/api/generate-flashcards', methods=['POST'])
def generate_flashcards_route():
    print("Received /api/generate-flashcards request")
    data = request.json
    notes = data.get('notes')
    original_text = data.get('original_text')
    existing_flashcards = data.get('existing_flashcards', '[]') # Pass as JSON string
    num_flashcards = data.get('num_flashcards', 10)

    if not notes and not original_text:
        return jsonify({"error": "Missing notes or original_text"}), 400

    result = generate_flashcards(notes, original_text, existing_flashcards, num_flashcards)
    if 'error' in result:
        return jsonify(result), 500
    print("Flashcard generation successful.")
    return jsonify(result), 200

@app.route('/api/generate-mindmap', methods=['POST'])
def generate_mindmap_route():
    print("Received /api/generate-mindmap request")
    data = request.json
    notes = data.get('notes')
    original_text = data.get('original_text')

    if not notes and not original_text:
        return jsonify({"error": "Missing notes or original_text"}), 400

    result = generate_mindmap_data(notes, original_text)
    if 'error' in result:
        return jsonify(result), 500
    print("Mind map generation successful.")
    return jsonify(result), 200


# --- Chat Route ---

@app.route('/api/chat', methods=['POST'])
def chat_route():
    print("Received /api/chat request")
    data = request.json
    notes = data.get('notes')
    original_text = data.get('original_text')
    history = data.get('history', []) # Expecting list of {"role": ..., "parts": ...}
    message = data.get('message')
    web_search_enabled = data.get('web_search_enabled', False) # Get flag from client state

    if not message:
        return jsonify({"error": "No message provided"}), 400
    if not notes and not original_text:
        return jsonify({"error": "Missing context (notes or original_text) for chat"}), 400

    result = chat_with_content(notes, original_text, history, message, web_search_enabled)
    if 'error' in result:
        return jsonify(result), 500
    print("Chat response generated.")
    return jsonify(result), 200


# --- Subjective Evaluation Route ---

@app.route('/api/evaluate-answer', methods=['POST'])
def evaluate_answer_route():
    print("Received /api/evaluate-answer request")
    data = request.json
    question = data.get('question')
    ideal_answer = data.get('ideal_answer')
    user_answer = data.get('user_answer')
    notes_context = data.get('notes_context') # Pass relevant notes snippet

    if not all([question, ideal_answer, user_answer is not None, notes_context]):
        return jsonify({"error": "Missing required parameters for evaluation"}), 400

    result = evaluate_subjective_answer(question, ideal_answer, user_answer, notes_context)
    if 'error' in result:
        return jsonify(result), 500
    print("Subjective answer evaluation successful.")
    return jsonify(result), 200


# --- Error Handlers (Keep as is) ---
@app.errorhandler(413)
def request_entity_too_large(error):
    # Corrected error message for file size
    return jsonify({"error": "Payload too large. Check file sizes or amount of text."}), 413

@app.errorhandler(500)
def internal_server_error(error):
    # Log the error for debugging
    app.logger.error(f"Internal Server Error: {error}")
    import traceback
    traceback.print_exc()
    return jsonify({"error": "An internal server error occurred. Please try again later."}), 500

@app.errorhandler(400)
def bad_request(error):
    # Provide more specific feedback if possible from error description
    message = error.description if hasattr(error, 'description') else "Bad request"
    return jsonify({"error": message}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Resource not found"}), 404

@app.errorhandler(Exception)
def handle_exception(e):
    # Log the exception details
    app.logger.error(f"Unhandled Exception: {str(e)}")
    import traceback
    traceback.print_exc() # Print stack trace to console/logs
    # Return a generic error message to the client
    return jsonify({"error": "An unexpected error occurred on the server."}), 500


# --- Main Entry Point ---
if __name__ == '__main__':
    # Removed init_db()
    print("Starting Flask server...")
    # Set host='0.0.0.0' to be accessible on the network if needed
    app.run(debug=True, host='127.0.0.1', port=5000)
