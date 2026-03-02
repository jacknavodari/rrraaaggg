import React, { useState, useEffect } from 'react';
import { Upload, FileText, MessageSquare, Database, Settings, Trash2, Search, Loader2, AlertCircle, CheckCircle, X, Cpu, Eye, Languages, Eraser, Download, Edit } from 'lucide-react';
import { parseFile } from './services/fileProcessor';
import { addDocument, getDocuments, deleteDocument, searchKnowledgeBase } from './services/knowledgeBase';

function App({ onReady }) {
  const [documents, setDocuments] = useState(() => {
    // Load documents from cache if available
    const cached = localStorage.getItem('rag_documents');
    return cached ? JSON.parse(cached) : [];
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [error, setError] = useState(null);
  const [chatMessages, setChatMessages] = useState(() => {
    // Load chat history from cache
    const cached = localStorage.getItem('rag_chat_history');
    return cached ? JSON.parse(cached) : [];
  });
  const [chatInput, setChatInput] = useState('');
  const [ollamaHost, setOllamaHost] = useState(() => {
    return localStorage.getItem('ollamaHost') || 'http://localhost:11434';
  });
  const [ocrModel, setOcrModel] = useState(() => {
    return localStorage.getItem('ocrModel') || 'deepseek-ocr:latest';
  });
  const [embeddingModel, setEmbeddingModel] = useState(() => {
    return localStorage.getItem('embeddingModel') || 'nomic-embed-text';
  });
  const [chatModel, setChatModel] = useState(() => {
    return localStorage.getItem('chatModel') || 'llama3.2:latest';
  });
  const [models, setModels] = useState([]);
  const [viewingDoc, setViewingDoc] = useState(null); // For preview
  const [showClearConfirm, setShowClearConfirm] = useState(false); // For clear chat confirmation
  const [translationLanguage, setTranslationLanguage] = useState('English'); // Default translation target
  const [showSaveModal, setShowSaveModal] = useState(false); // For save/download modal
  const [editingMessageIndex, setEditingMessageIndex] = useState(null); // For editing messages
  const [editedMessageContent, setEditedMessageContent] = useState(''); // Edited content

  // Load documents on mount
  useEffect(() => {
    const initializeApp = async () => {
      try {
        await loadDocuments();
        await fetchModels();
      } catch (err) {
        console.error('[RAG] Initialization error:', err);
        setError(`Failed to initialize: ${err.message}`);
      } finally {
        // ALWAYS remove loading screen, even if there's an error
        setTimeout(() => {
          if (onReady) {
            onReady();
            console.log('[RAG] App ready (or failed), removed loading screen');
          }
        }, 300); // Short delay to show error if any
      }
    };
    
    initializeApp();
  }, []);

  // Reload documents when returning to the page
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[RAG] Page visible, reloading documents...');
        loadDocuments();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Fetch models when host changes
  useEffect(() => {
    fetchModels();
  }, [ollamaHost]);

  // Save model selections to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('ollamaHost', ollamaHost);
  }, [ollamaHost]);

  useEffect(() => {
    localStorage.setItem('ocrModel', ocrModel);
  }, [ocrModel]);

  useEffect(() => {
    localStorage.setItem('embeddingModel', embeddingModel);
  }, [embeddingModel]);

  useEffect(() => {
    localStorage.setItem('chatModel', chatModel);
  }, [chatModel]);

  // Save documents list when it changes
  useEffect(() => {
    try {
      localStorage.setItem('rag_documents', JSON.stringify(documents));
    } catch (e) {
      console.warn('[RAG] Could not cache documents:', e);
    }
  }, [documents]);

  // Save chat history when it changes
  useEffect(() => {
    try {
      localStorage.setItem('rag_chat_history', JSON.stringify(chatMessages));
    } catch (e) {
      console.warn('[RAG] Could not cache chat:', e);
    }
  }, [chatMessages]);

  const fetchModels = async () => {
    try {
      const response = await fetch(`${ollamaHost}/api/tags`);
      if (!response.ok) throw new Error('Failed to fetch models');
      const data = await response.json();
      setModels(data.models || []);
      console.log('[RAG] Available models:', data.models?.map(m => m.name).join(', '));
    } catch (err) {
      console.error('[RAG] Could not fetch models:', err.message);
      setModels([]);
    }
  };

  const loadDocuments = async () => {
    try {
      const docs = await getDocuments();
      setDocuments(docs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)));
    } catch (err) {
      console.error("Failed to load documents", err);
      setError("Failed to load documents.");
    }
  };

  // Send entire document content to chat - puts text in INPUT box
  const sendDocumentToChat = (doc) => {
    if (!doc || !doc.content) return;
    
    console.log(`[CHAT] Loading document ${doc.name} into input box (${doc.content.length} chars)`);
    
    // Put the FULL document text in the chat input box
    const fullText = `Here is the complete document "${doc.name}" (${doc.content.length} characters):

${doc.content}

`;
    
    setChatInput(fullText);
    
    // Show confirmation
    setChatMessages(prev => [
      ...prev,
      { 
        role: 'system', 
        content: `✅ Document loaded into input box. Add your question/prompt and press Enter!` 
      }
    ]);
  };

  // Send document for FULL translation - puts text in INPUT box with language selector
  const translateFullDocument = (doc) => {
    if (!doc || !doc.content) return;
    
    console.log(`[TRANSLATE] Current language setting: ${translationLanguage}`);
    console.log(`[TRANSLATE] Loading ${doc.name} into input box for translation (${doc.content.length} chars)`);
    
    // Create the translation request WITH the full document in the input box
    // Format that FORCES the model to recognize it's a translation task
    const translationText = `TRANSLATION TASK: Translate the following document from its original language to ${translationLanguage}.

IMPORTANT: This is a COMPLETE translation request. You must translate EVERY SINGLE WORD.

Target Language: ${translationLanguage}

Document to translate:
${doc.content}

---
Translate ALL of the text above to ${translationLanguage}. Do not skip anything. Translate word-for-word.`;
    
    // Put it in the chat input box
    setChatInput(translationText);
    
    // Show confirmation with current language
    setChatMessages(prev => [
      ...prev,
      { 
        role: 'system', 
        content: `✅ Translation to ${translationLanguage} loaded. Text is in input box below. Press Send to translate!` 
      }
    ]);
  };

  // Clear all chat messages
  const clearChat = () => {
    setShowClearConfirm(true);
  };

  // Confirm clearing chat
  const confirmClearChat = () => {
    setChatMessages([]);
    localStorage.removeItem('rag_chat_history');
    setShowClearConfirm(false);
    console.log('[RAG] Chat cleared');
  };

  // Cancel clearing chat
  const cancelClearChat = () => {
    setShowClearConfirm(false);
  };

  // Save chat to text file
  const saveChatAsText = () => {
    const chatText = chatMessages.map(msg => 
      `${msg.role === 'user' ? '👤 You' : msg.role === 'assistant' ? '🤖 AI' : '⚙️ System'}: ${msg.content}`
    ).join('\n\n---\n\n');
    
    const blob = new Blob([chatText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowSaveModal(false);
  };

  // Save chat as PDF (simple version using print)
  const saveChatAsPDF = () => {
    const printWindow = window.open('', '_blank');
    const chatHTML = chatMessages.map(msg => `
      <div style="margin: 20px; padding: 15px; border-left: 4px solid ${msg.role === 'user' ? '#3b82f6' : '#8b5cf6'}; background: #f9fafb;">
        <strong>${msg.role === 'user' ? '👤 You' : msg.role === 'assistant' ? '🤖 AI' : '⚙️ System'}:</strong><br/>
        <div style="white-space: pre-wrap; margin-top: 10px;">${msg.content}</div>
      </div>
    `).join('');
    
    printWindow.document.write(`
      <html>
        <head><title>Chat Export</title></head>
        <body style="font-family: Arial, sans-serif; padding: 40px;">
          <h1>Chat Conversation</h1>
          <p style="color: #666;">Exported: ${new Date().toLocaleString()}</p>
          ${chatHTML}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
    setShowSaveModal(false);
  };

  // Save current document as text
  const saveDocumentAsText = (doc) => {
    if (!doc || !doc.content) return;
    
    const blob = new Blob([doc.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.name.replace(/\.[^/.]+$/, '')}-extracted.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Save single message
  const saveSingleMessage = (msg, index) => {
    const sender = msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'AI' : 'System';
    const messageText = `From: ${sender}\nDate: ${new Date().toLocaleString()}\n\n${msg.content}`;
    
    const blob = new Blob([messageText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `message-${index + 1}-${sender.toLowerCase()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Start editing a message
  const startEditingMessage = (msg, index) => {
    setEditingMessageIndex(index);
    setEditedMessageContent(msg.content);
  };

  // Save edited message
  const saveEditedMessage = () => {
    if (editingMessageIndex === null) return;
    
    const updatedMessages = [...chatMessages];
    updatedMessages[editingMessageIndex] = {
      ...updatedMessages[editingMessageIndex],
      content: editedMessageContent
    };
    
    setChatMessages(updatedMessages);
    setEditingMessageIndex(null);
    setEditedMessageContent('');
    
    // Also update localStorage
    localStorage.setItem('rag_chat_history', JSON.stringify(updatedMessages));
  };

  // Cancel editing
  const cancelEditingMessage = () => {
    setEditingMessageIndex(null);
    setEditedMessageContent('');
  };

  const handleFileUpload = async (files) => {
    setError(null);
    
    for (const file of files) {
      try {
        setProcessingStatus(`Processing ${file.name}...`);
        setIsProcessing(true);
        
        console.log(`[RAG] Starting upload: ${file.name}`);
        console.log(`[RAG] Using OCR Model: ${ocrModel}`);
        console.log(`[RAG] Using Host: ${ollamaHost}`);
        
        const text = await parseFile(file, ocrModel, ollamaHost, (count) => {
          setProcessingStatus(`Extracting: ${count} characters...`);
        });

        console.log(`[RAG] Extracted ${text.length} characters from ${file.name}`);
        
        if (text.length === 0) {
          setError(`Warning: No text extracted from ${file.name}. Document may be empty or unreadable.`);
          continue;
        }

        console.log(`[RAG] Adding document with embedding model: ${embeddingModel}`);
        await addDocument(file, text, embeddingModel, ollamaHost);
        console.log(`[RAG] Successfully processed ${file.name}`);
        
      } catch (err) {
        console.error(`Error processing ${file.name}:`, err);
        console.error(`Stack trace:`, err.stack);
        setError(`Failed to process ${file.name}: ${err.message}. Check console for details.`);
      }
    }

    setIsProcessing(false);
    setProcessingStatus('');
    loadDocuments();
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;

    const userMessage = chatInput;
    console.log('[CHAT] Sending message (length:', userMessage.length, 'chars)');
    console.log('[CHAT] First 200 chars:', userMessage.substring(0, 200));
    
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setChatInput('');

    // Check if user wants to see full document content
    const lowerMsg = userMessage.toLowerCase();
    if (lowerMsg.includes('show all') || lowerMsg.includes('full content') || lowerMsg.includes('everything') || lowerMsg.includes('whole text') || 
        lowerMsg.includes('read entire') || lowerMsg.includes('complete file') || lowerMsg.includes('full document')) {
      // Find the most recent document and show it
      const lastDoc = documents[0];
      if (lastDoc && lastDoc.content) {
        console.log(`[CHAT] Showing complete document: ${lastDoc.name} (${lastDoc.content.length} chars)`);
        setChatMessages(prev => [...prev, { 
          role: 'assistant', 
          content: `Here's the COMPLETE content of ${lastDoc.name} (${lastDoc.content.length} characters):\n\n${lastDoc.content}` 
        }]);
        return;
      }
    }

    // Check if asking about a specific document
    if (lowerMsg.includes('this document') || lowerMsg.includes('this file') || lowerMsg.includes('the pdf') || lowerMsg.includes('the file')) {
      const lastDoc = documents[0];
      if (lastDoc && lastDoc.content) {
        console.log(`[CHAT] User asking about current document`);
        console.log(`[CHAT] Document has ${lastDoc.content.length} chars, but user may have edited it`);
        console.log(`[CHAT] Using user's EDITED version from input box (${userMessage.length} chars)`);
        
        // IMPORTANT: Use the EDITED text from input box, not original document!
        // The user's modifications in chatInput are what should be processed
        try {
          const response = await fetch(`${ollamaHost}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: chatModel,
              messages: [
                {
                  role: 'system',
                  content: `You are a PROFESSIONAL TRANSLATOR. Your ONLY task is to translate text completely.

CRITICAL RULES FOR TRANSLATION:
1. Translate EVERY SINGLE WORD - do not skip anything
2. Do NOT summarize, abbreviate, or shorten
3. Translate section-by-section until COMPLETE
4. Never say "etc" or leave parts untranslated
5. Preserve ALL formatting, numbers, dates, names
6. Continue translating until you reach the END of the text
7. DO NOT stop mid-sentence - finish everything
8. Output ONLY the translation - no explanations, no meta-commentary

This is a FULL translation task. Partial translations are UNACCEPTABLE!
Translate from the source language to the target language specified.`
                },
                {
                  role: 'user',
                  content: `Here is the COMPLETE document (${lastDoc.name}):

${lastDoc.content}

Question: ${userMessage}`
                }
              ],
              stream: true,
              options: {
                temperature: 0.3,  // Lower for accurate translation
                top_p: 0.9,
                num_predict: 16384,  // Very high limit
                repeat_penalty: 1.05
              }
            })
          });

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let aiResponse = '';
          let isFirstChunk = true;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n').filter(line => line.trim());

            for (const line of lines) {
              try {
                const json = JSON.parse(line);
                if (json.message?.content) {
                  aiResponse += json.message.content;
                  
                  if (isFirstChunk) {
                    setChatMessages(prev => [...prev, { role: 'assistant', content: aiResponse }]);
                    isFirstChunk = false;
                  } else {
                    setChatMessages(prev => {
                      const updated = [...prev];
                      updated[updated.length - 1] = { role: 'assistant', content: aiResponse };
                      return updated;
                    });
                  }
                }
              } catch (e) {
                // Skip invalid JSON
              }
            }
          }

          return;
        } catch (err) {
          console.error("Error getting response:", err);
          setChatMessages(prev => [...prev, { 
            role: 'system', 
            content: `Error: ${err.message}. Make sure Ollama is running at ${ollamaHost}` 
          }]);
          return;
        }
      }
    }

    try {
      // Search knowledge base for relevant context
      const results = await searchKnowledgeBase(userMessage, embeddingModel, 10); // Increased from 5 to 10
      
      let context = '';
      if (results && results.length > 0) {
        context = results.map(r => r.text).join('\n\n');
      }

      console.log(`[CHAT] Sending request with context length: ${context.length} chars`);
      console.log(`[CHAT] Number of chunks: ${results?.length || 0}`);

      // Send to LLM with context
      const response = await fetch(`${ollamaHost}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: chatModel,
          messages: [
            {
              role: 'system',
              content: `You are a helpful, conversational AI assistant. You have access to document context and can answer questions naturally.

IMPORTANT RULES:
1. Be conversational and friendly, not robotic
2. When asked about documents, provide COMPLETE information - never summarize briefly unless asked
3. If user asks to "show all", "display everything", or "full content" - provide the ENTIRE text without holding back
4. Don't be fixed or rigid - adapt to what the user wants
5. Provide detailed, thorough responses by default
6. Use natural language, not formal/corporate speak
7. If there's relevant context from documents, share it ALL
8. **CRITICAL**: When asked to TRANSLATE, you MUST translate EVERYTHING - no skipping, no summarizing, no partial translations
9. Translate the COMPLETE text word-for-word or section-by-section until done
10. Never say "here's a summary" when asked to translate - give FULL translation

Remember: User wants complete, natural conversations - not short summaries! For translation tasks: COMPLETE coverage is MANDATORY!`
            },
            {
              role: 'user',
              content: `Context from documents (use this to answer thoroughly):\n${context}\n\nQuestion: ${userMessage}`
            }
          ],
          stream: true,
          options: {
            temperature: 0.7,
            top_p: 0.9,
            num_predict: 8192,  // Increased from 4096 for long translations
            repeat_penalty: 1.1
          }
        })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let aiResponse = '';
      let isFirstChunk = true;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            if (json.message?.content) {
              aiResponse += json.message.content;
              
              if (isFirstChunk) {
                setChatMessages(prev => [...prev, { role: 'assistant', content: aiResponse }]);
                isFirstChunk = false;
              } else {
                setChatMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { role: 'assistant', content: aiResponse };
                  return updated;
                });
              }
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }

    } catch (err) {
      console.error("Chat error:", err);
      setChatMessages(prev => [...prev, { 
        role: 'system', 
        content: `Error: ${err.message}. Make sure Ollama is running at ${ollamaHost}` 
      }]);
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Delete this document?')) {
      await deleteDocument(id);
      loadDocuments();
    }
  };

  return (
    <div className="h-screen flex bg-slate-950 text-white">
      {/* Sidebar */}
      <div className="w-80 border-r border-slate-800 flex flex-col">
        <div className="p-4 border-b border-slate-800">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            rrraaaggg
          </h1>
          <p className="text-xs text-slate-400 mt-1">RAG Document Processor</p>
        </div>

        {/* Settings */}
        <div className="p-4 border-b border-slate-800 space-y-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Ollama Host</label>
            <input
              type="text"
              value={ollamaHost}
              onChange={(e) => setOllamaHost(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm font-mono"
            />
            <div className="flex gap-1 mt-2">
              <button
                onClick={() => setOllamaHost('http://localhost:11434')}
                className={`flex-1 px-2 py-1 text-[10px] rounded transition-colors ${
                  ollamaHost === 'http://localhost:11434'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                🏠 Local
              </button>
              <button
                onClick={() => setOllamaHost('http://192.168.0.136:11434')}
                className={`flex-1 px-2 py-1 text-[10px] rounded transition-colors ${
                  ollamaHost === 'http://192.168.0.136:11434'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                🌐 Remote
              </button>
              <button
                onClick={() => setOllamaHost('http://192.168.1.100:11434')}
                className={`flex-1 px-2 py-1 text-[10px] rounded transition-colors ${
                  ollamaHost === 'http://192.168.1.100:11434'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
                title="Custom network IP"
              >
                📡 Network
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              Current: <span className="font-mono text-slate-300">{ollamaHost}</span>
            </p>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">OCR Model</label>
            <select
              value={ocrModel}
              onChange={(e) => setOcrModel(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm"
            >
              {models.length === 0 ? (
                <option value="deepseek-ocr:latest">deepseek-ocr:latest (default)</option>
              ) : (
                models.map(m => (
                  <option key={`ocr-${m.name}`} value={m.name}>
                    {m.name} {m.name.includes('ocr') || m.name.includes('vision') || m.name.includes('llava') ? '👁️' : ''}
                  </option>
                ))
              )}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Embedding Model</label>
            <select
              value={embeddingModel}
              onChange={(e) => setEmbeddingModel(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm"
            >
              {models.length === 0 ? (
                <option value="nomic-embed-text">nomic-embed-text (default)</option>
              ) : (
                models.map(m => (
                  <option key={`embed-${m.name}`} value={m.name}>
                    {m.name} {m.name.includes('embed') ? '🧠' : ''}
                  </option>
                ))
              )}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1 flex items-center gap-1">
              <Cpu className="w-3 h-3" />
              Chat Model
            </label>
            <select
              value={chatModel}
              onChange={(e) => setChatModel(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm font-medium"
            >
              {models.length === 0 ? (
                <option value="llama3.2:latest">llama3.2:latest (default)</option>
              ) : (
                models.map(m => (
                  <option key={`chat-${m.name}`} value={m.name}>
                    {m.name} {m.size ? `(${(m.size / 1024 / 1024 / 1024).toFixed(1)}GB)` : ''}
                  </option>
                ))
              )}
            </select>
            {models.length > 0 && (
              <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
                <CheckCircle className="w-3 h-3 text-green-500" />
                {models.length} models available from Ollama
              </p>
            )}
          </div>
        </div>

        {/* Upload Area */}
        <div className="p-4 flex-1 overflow-y-auto">
          <div
            className="border-2 border-dashed border-slate-700 rounded-lg p-6 text-center hover:border-blue-500 transition-colors cursor-pointer"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleFileUpload(Array.from(e.dataTransfer.files));
            }}
            onClick={() => document.getElementById('file-input').click()}
          >
            <Upload className="w-8 h-8 mx-auto text-slate-500 mb-2" />
            <p className="text-sm text-slate-400">Drop files here or click</p>
            <p className="text-xs text-slate-500 mt-1">PDF, DOCX, TXT, MD, Images</p>
          </div>
          <input
            id="file-input"
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp"
            className="hidden"
            onChange={(e) => handleFileUpload(Array.from(e.target.files))}
          />

          {/* Document List */}
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                <Database className="w-4 h-4" />
                Documents ({documents.length})
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Translate to:</span>
                <select
                  value={translationLanguage}
                  onChange={(e) => setTranslationLanguage(e.target.value)}
                  className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none cursor-pointer min-w-[140px]"
                  title="Select translation language"
                >
                  <option value="English">🇬🇧 English</option>
                  <option value="Romanian">🇷🇴 Romanian</option>
                  <option value="French">🇫🇷 French</option>
                  <option value="Spanish">🇪🇸 Spanish</option>
                  <option value="German">🇩🇪 German</option>
                  <option value="Italian">🇮🇹 Italian</option>
                  <option value="Portuguese">🇵🇹 Portuguese</option>
                  <option value="Russian">🇷🇺 Russian</option>
                  <option value="Chinese">🇨🇳 Chinese</option>
                  <option value="Japanese">🇯🇵 Japanese</option>
                  <option value="Korean">🇰🇷 Korean</option>
                  <option value="Arabic">🇸🇦 Arabic</option>
                  <option value="Turkish">🇹🇷 Turkish</option>
                  <option value="Hungarian">🇭🇺 Hungarian</option>
                </select>
              </div>
            </div>
            {documents.map(doc => (
              <div key={doc.id} className="bg-slate-900 rounded p-2 flex items-center justify-between group">
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{doc.name}</p>
                  <p className="text-xs text-slate-500">
                    {doc.status === 'ready' ? '✅ Ready' : doc.status === 'processing' ? '⏳ Processing' : '❌ Error'}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setViewingDoc(doc)}
                    className="p-1 hover:bg-blue-500/20 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Preview extracted text"
                  >
                    <Eye className="w-4 h-4 text-blue-400" />
                  </button>
                  <button
                    onClick={() => sendDocumentToChat(doc)}
                    className="p-1 hover:bg-green-500/20 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Send entire document to chat"
                  >
                    <MessageSquare className="w-4 h-4 text-green-400" />
                  </button>
                  <button
                    onClick={() => translateFullDocument(doc)}
                    className="p-1 hover:bg-purple-500/20 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Translate full document"
                  >
                    <Languages className="w-4 h-4 text-purple-400" />
                  </button>
                  <button
                    onClick={() => handleDelete(doc.id)}
                    className="p-1 hover:bg-red-500/20 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Status Bar */}
        {isProcessing && (
          <div className="bg-blue-500/10 border-b border-blue-500/20 p-3 flex items-center gap-3">
            <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
            <span className="text-sm text-blue-400">{processingStatus}</span>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border-b border-red-500/20 p-3 flex items-center gap-3">
            <AlertCircle className="w-4 h-4 text-red-400" />
            <span className="text-sm text-red-400">{error}</span>
            <button onClick={() => setError(null)} className="ml-auto hover:bg-red-500/20 rounded p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Chat Area */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Chat Header with Clear Button */}
          <div className="flex items-center justify-between p-2 border-b border-slate-800 bg-slate-900/30">
            <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              Chat
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => setShowSaveModal(true)}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-green-600/20 hover:bg-green-600/30 text-green-400 rounded transition-colors border border-green-500/20"
                title="Save/Export chat"
              >
                <Download className="w-3 h-3" />
                <span>Save</span>
              </button>
              <button
                onClick={clearChat}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded transition-colors border border-red-500/20"
                title="Clear all chat messages"
              >
                <Eraser className="w-3 h-3" />
                <span>Clear Chat</span>
              </button>
            </div>
          </div>
          
          <div className="flex-1 p-4 overflow-y-auto space-y-4 custom-scrollbar">
            {chatMessages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : msg.role === 'system' ? 'justify-center' : 'justify-start'} group`}
              >
                <div
                  className={`max-w-[95%] rounded-lg p-4 relative ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : msg.role === 'system'
                      ? 'bg-red-600/20 text-red-400 border border-red-500/20'
                      : 'bg-slate-800 text-slate-200'
                  }`}
                >
                  {/* Save button for individual message */}
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => startEditingMessage(msg, i)}
                      className="p-1.5 bg-white/10 hover:bg-white/20 rounded"
                      title="Edit this message"
                    >
                      <Edit className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => saveSingleMessage(msg, i)}
                      className="p-1.5 bg-white/10 hover:bg-white/20 rounded"
                      title="Save this message"
                    >
                      <Download className="w-3 h-3" />
                    </button>
                  </div>
                  
                  {editingMessageIndex === i ? (
                    // Edit mode
                    <div className="space-y-2">
                      <textarea
                        value={editedMessageContent}
                        onChange={(e) => setEditedMessageContent(e.target.value)}
                        className="w-full h-96 bg-slate-900/50 border border-white/20 rounded p-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono leading-relaxed"
                        placeholder="Edit your message here..."
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={saveEditedMessage}
                          className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm rounded font-medium transition-colors flex items-center gap-1"
                        >
                          ✓ Save Edits
                        </button>
                        <button
                          onClick={cancelEditingMessage}
                          className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white text-sm rounded font-medium transition-colors flex items-center gap-1"
                        >
                          ✕ Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    // View mode
                    <p className="text-sm whitespace-pre-wrap leading-relaxed break-words pr-8">{msg.content}</p>
                  )}
                </div>
              </div>
            ))}
            {chatMessages.length === 0 && (
              <div className="text-center text-slate-500 mt-20">
                <MessageSquare className="w-16 h-16 mx-auto mb-4 opacity-20" />
                <p>Ask questions about your documents</p>
                <p className="text-xs mt-2">Upload files first, then start chatting!</p>
              </div>
            )}
          </div>

          {/* Chat Input */}
          <div className="border-t border-slate-800 p-4 bg-slate-900/30">
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Type your message here... or click green/purple button to load document"
              className="w-full h-32 bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none font-mono text-slate-200"
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={handleSendMessage}
                disabled={!chatInput.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white px-6 py-3 rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
              >
                <MessageSquare className="w-5 h-5" />
                <span>Send</span>
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1">
              ✅ Full-length responses enabled • Complete text always shown • Scroll to see everything
            </p>
          </div>
        </div>
      </div>

      {/* Document Preview Modal */}
      {viewingDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
            
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-slate-800 bg-slate-900/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/10 rounded-lg">
                  <FileText className="w-6 h-6 text-blue-500" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">{viewingDoc.name}</h2>
                  <p className="text-xs text-slate-400">
                    {(viewingDoc.size / 1024).toFixed(1)} KB • {viewingDoc.content?.split(/\s+/).length || 0} words • {viewingDoc.content?.length || 0} characters
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setViewingDoc(null)} 
                className="p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              <div className="bg-slate-950/50 rounded-xl p-4 border border-slate-800">
                <pre className="text-slate-300 font-mono text-sm whitespace-pre-wrap leading-relaxed">
                  {viewingDoc.content || 'No content available'}
                </pre>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="border-t border-slate-800 p-4 bg-slate-900/50 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span>Status: {viewingDoc.status === 'ready' ? 'Ready for RAG' : viewingDoc.status}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(viewingDoc.content || '');
                    alert('Copied to clipboard!');
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Copy Text
                </button>
                <button
                  onClick={() => setViewingDoc(null)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Clear Chat Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border-2 border-red-500/50 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl transform transition-all animate-in fade-in zoom-in duration-200">
            <div className="text-center">
              <div className="mx-auto w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-4">
                <Eraser className="w-8 h-8 text-red-500" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Clear All Chat?</h3>
              <p className="text-slate-400 mb-6">
                This will delete ALL messages permanently. This action cannot be undone!
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={cancelClearChat}
                  className="px-6 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmClearChat}
                  className="px-6 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                  <Eraser className="w-4 h-4" />
                  Yes, Clear Everything
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save/Export Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border-2 border-green-500/50 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <div className="text-center">
              <div className="mx-auto w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mb-4">
                <Download className="w-8 h-8 text-green-500" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Save Chat</h3>
              <p className="text-slate-400 mb-6">
                Choose format to export your chat:
              </p>
              <div className="space-y-3">
                <button
                  onClick={saveChatAsText}
                  className="w-full px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <FileText className="w-5 h-5" />
                  Save as TXT
                </button>
                <button
                  onClick={saveChatAsPDF}
                  className="w-full px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <Download className="w-5 h-5" />
                  Save as PDF
                </button>
                <button
                  onClick={() => setShowSaveModal(false)}
                  className="w-full px-6 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
