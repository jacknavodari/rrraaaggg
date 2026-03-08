import { openDB } from 'idb';
import { v4 as uuidv4 } from 'uuid';

const DB_NAME = 'RrraaagggKB';
const STORE_NAME = 'documents';
const VECTOR_STORE_NAME = 'vectors';

const initDB = async () => {
    return openDB(DB_NAME, 1, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(VECTOR_STORE_NAME)) {
                db.createObjectStore(VECTOR_STORE_NAME, { keyPath: 'id' });
            }
        },
    });
};

// Simple cosine similarity
const cosineSimilarity = (vecA, vecB) => {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

export const addDocument = async (file, text, embeddingModel = 'nomic-embed-text', ollamaHost = 'http://localhost:11434') => {
    const db = await initDB();
    const docId = uuidv4();

    console.log(`[RAG] Processing ${file.name}: ${text.length} chars`);

    // Verify embedding model exists
    try {
        const tagsResponse = await fetch(`${ollamaHost}/api/tags`);
        if (tagsResponse.ok) {
            const data = await tagsResponse.json();
            const exists = data.models?.some(m => m.name === embeddingModel || m.name.split(':')[0] === embeddingModel);
            if (!exists) {
                throw new Error(`Embedding model "${embeddingModel}" not found in Ollama. Please run "ollama pull ${embeddingModel}"`);
            }
        }
    } catch (e) {
        console.warn("[RAG] Could not verify model existence:", e.message);
    }

    // Split into smaller, safer chunks (500 characters max for high compatibility)
    const chunks = [];
    const rawParagraphs = text.split(/\n\s*\n/).filter(p => p.trim());
    
    for (const para of rawParagraphs) {
        if (para.length <= 800) {
            chunks.push(para);
        } else {
            // Split long paragraphs into 800-char chunks with 100-char overlap
            for (let i = 0; i < para.length; i += 700) {
                chunks.push(para.substring(i, i + 800));
            }
        }
    }

    console.log(`[RAG] Created ${chunks.length} safe chunks for ${file.name}`);

    // Store document metadata
    await db.put(STORE_NAME, {
        id: docId,
        name: file.name,
        type: file.type,
        size: file.size,
        content: text,
        embeddingModel,
        uploadedAt: new Date().toISOString(),
        status: 'processing',
        summary: `Document with ${text.split(/\s+/).length} words`,
        tags: ['document']
    });

    try {
        const vectorData = [];

        // Generate embeddings for each chunk
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i].trim();
            if (!chunk) continue;

            console.log(`[RAG] Embedding chunk ${i + 1}/${chunks.length}...`);
            
            // Try newer /api/embed first, fallback to /api/embeddings
            let response;
            try {
                response = await fetch(`${ollamaHost}/api/embed`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: embeddingModel,
                        input: chunk
                    })
                });
                
                if (!response.ok) throw new Error("New API failed");
                const data = await response.json();
                const embedding = data.embeddings?.[0];
                
                if (embedding) {
                    vectorData.push({
                        id: uuidv4(),
                        docId: docId,
                        text: chunk,
                        vector: embedding
                    });
                    continue; // Success
                }
            } catch (e) {
                console.log("[RAG] /api/embed not supported or failed, falling back to /api/embeddings");
                response = await fetch(`${ollamaHost}/api/embeddings`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: embeddingModel,
                        prompt: chunk
                    })
                });
            }

            if (!response.ok) {
                throw new Error(`Embedding failed: ${response.statusText} (500 often means Ollama is out of memory or model is too large)`);
            }

            const data = await response.json();
            const embedding = data.embedding;

            if (embedding && embedding.length > 0) {
                console.log(`[RAG] Chunk ${i + 1} embedded (dim: ${embedding.length})`);
                vectorData.push({
                    id: uuidv4(),
                    docId: docId,
                    text: chunk,
                    vector: embedding
                });
            } else {
                console.warn(`[RAG] Chunk ${i + 1} failed to embed.`);
            }
        }

        if (vectorData.length === 0) {
            throw new Error("No embeddings generated");
        }

        // Store vectors
        console.log(`[RAG] Saving ${vectorData.length} vectors...`);
        const tx = db.transaction(VECTOR_STORE_NAME, 'readwrite');
        await Promise.all(vectorData.map(v => tx.store.put(v)));
        await tx.done;

        // Update status
        const doc = await db.get(STORE_NAME, docId);
        doc.status = 'ready';
        await db.put(STORE_NAME, doc);

        console.log(`[RAG] ${file.name} is ready.`);
        return doc;

    } catch (error) {
        console.error("[RAG] Embedding failed:", error);
        const doc = await db.get(STORE_NAME, docId);
        if (doc) {
            doc.status = 'error';
            doc.error = error.message;
            await db.put(STORE_NAME, doc);
        }
        throw error;
    }
};

export const getDocuments = async () => {
    const db = await initDB();
    return await db.getAll(STORE_NAME);
};

export const deleteDocument = async (id) => {
    const db = await initDB();
    await db.delete(STORE_NAME, id);

    const allVectors = await db.getAll(VECTOR_STORE_NAME);
    const vectorsToDelete = allVectors.filter(v => v.docId === id);

    const tx = db.transaction(VECTOR_STORE_NAME, 'readwrite');
    await Promise.all(vectorsToDelete.map(v => tx.store.delete(v.id)));
    await tx.done;
};

export const searchKnowledgeBase = async (query, model = 'nomic-embed-text', topK = 5, ollamaHost = 'http://localhost:11434') => {
    if (!query || !query.trim()) return [];
    
    // Safety: Truncate very long queries for embedding. 
    // RAG queries should be concise; very long ones are likely mistakes or full documents.
    const safeQuery = query.length > 2000 ? query.substring(0, 2000) : query;
    
    const db = await initDB();

    // Verify model exists before requesting embeddings
    try {
        const tagsResponse = await fetch(`${ollamaHost}/api/tags`);
        if (tagsResponse.ok) {
            const data = await tagsResponse.json();
            const exists = data.models?.some(m => m.name === model || m.name.split(':')[0] === model);
            if (!exists) {
                throw new Error(`Embedding model "${model}" not found. Please run "ollama pull ${model}"`);
            }
        }
    } catch (e) {
        if (e.message.includes('not found')) throw e;
        console.warn("[RAG] Could not verify model existence:", e.message);
    }

    // Generate query embedding
    let response;
    try {
        response = await fetch(`${ollamaHost}/api/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model,
                input: [safeQuery] // Using array for better compatibility
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            const queryEmbedding = data.embeddings?.[0];
            if (queryEmbedding) {
                return await computeResults(db, queryEmbedding, topK);
            }
        }
        throw new Error("New API failed");
    } catch (e) {
        console.log("[RAG] /api/embed not supported or failed, falling back to /api/embeddings");
        response = await fetch(`${ollamaHost}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model,
                prompt: safeQuery
            })
        });
    }

    if (!response.ok) {
        if (response.status === 500) {
            throw new Error(`Embedding failed (Internal Server Error). This model might not support embeddings or the input is too complex. Model: ${model}`);
        }
        throw new Error(`Query embedding failed: ${response.statusText}`);
    }

    const data = await response.json();
    const queryEmbedding = data.embedding;

    if (!queryEmbedding) {
        return [];
    }

    return await computeResults(db, queryEmbedding, topK);
};

const computeResults = async (db, queryEmbedding, topK) => {
    // Get all vectors and compute similarity
    const allVectors = await db.getAll(VECTOR_STORE_NAME);

    const results = allVectors.map(vec => ({
        ...vec,
        score: cosineSimilarity(queryEmbedding, vec.vector)
    }));

    results.sort((a, b) => b.score - a.score);

    return results.slice(0, topK);
};

export const unloadModel = async (ollamaHost, modelName) => {
    if (!modelName) return;
    console.log(`[RAG] 🧹 Unloading ${modelName} to free VRAM...`);
    
    try {
        // Try generic generate endpoint (works for most) with keep_alive: 0
        await fetch(`${ollamaHost}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelName, keep_alive: 0 })
        });
        
        // Also try chat endpoint explicitly
        await fetch(`${ollamaHost}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelName, keep_alive: 0 })
        });
    } catch (e) {
        // Silent fail - we tried our best
    }
};
