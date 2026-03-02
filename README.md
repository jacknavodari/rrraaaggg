# rrraaaggg - RAG Document Processor

A clean, focused RAG (Retrieval-Augmented Generation) application for document processing and AI-powered chat.

## Features

✅ **File Processing**
- PDF extraction (native text + OCR fallback)
- DOCX extraction
- Plain text & Markdown support
- Image OCR (PNG, JPG, JPEG, WebP)

✅ **RAG Capabilities**
- Automatic document chunking
- Vector embeddings generation
- Semantic search
- Context-aware chat responses

✅ **Model Support**
- Configurable OCR models (deepseek-ocr, minicpm-v, llava-ocr)
- Embedding models (nomic-embed-text, mxbai-embed-large)
- Chat models (llama3.2, gpt-oss, qwen2.5)
- Works with any Ollama-compatible models

## Quick Start

1. **Install dependencies:**
```bash
cd rrraaaggg
npm install
```

2. **Start development server:**
```bash
npm run dev
```

3. **Open browser:** http://localhost:5175

## Usage

### 1. Configure Models
Set your preferred models in the sidebar:
- **OCR Model**: For image/PDF text extraction
- **Embedding Model**: For vector generation
- **Chat Model**: For answering questions

### 2. Upload Documents
- Drag & drop files or click to upload
- Supported formats: PDF, DOCX, TXT, MD, Images
- Watch processing status in real-time

### 3. Chat with Documents
- Ask questions about uploaded documents
- AI retrieves relevant context automatically
- Get accurate answers based on your content

## Architecture

```
rrraaaggg/
├── src/
│   ├── App.jsx              # Main application
│   ├── main.jsx             # Entry point
│   ├── index.css            # Styles
│   └── services/
│       ├── fileProcessor.js  # File parsing & OCR
│       └── knowledgeBase.js  # RAG operations
├── package.json
├── vite.config.js
└── tailwind.config.js
```

## Technical Details

**Storage**: IndexedDB (local browser storage)
- Documents stored locally
- Vector embeddings cached
- No server required

**Processing Flow**:
1. Upload → Parse file (OCR if needed)
2. Chunk → Split into manageable pieces
3. Embed → Generate vectors using embedding model
4. Store → Save in IndexedDB
5. Search → Find relevant chunks via cosine similarity
6. Respond → Chat model generates answer with context

## Requirements

- Node.js 18+
- Ollama running at http://localhost:11434 (or configure custom host)
- Required models installed in Ollama:
  - OCR: `deepseek-ocr:latest` or similar
  - Embedding: `nomic-embed-text:latest`
  - Chat: `llama3.2:latest` or similar

## Example Ollama Commands

```bash
# Install OCR model
ollama pull deepseek-ocr:latest

# Install embedding model
ollama pull nomic-embed-text:latest

# Install chat model
ollama pull llama3.2:latest

# Check running models
ollama list
```

## Troubleshooting

**No text extracted from PDF:**
- Try different OCR model
- Ensure PDF is scanned (not just native text)
- Check Ollama logs for OCR errors

**Embedding generation fails:**
- Verify embedding model is installed
- Check Ollama connection in settings
- Increase timeout for large documents

**Chat not responding:**
- Make sure chat model is downloaded
- Verify Ollama is running (`ollama list`)
- Check browser console for errors

## License

MIT - Clean, simple, and focused on doing RAG right!
