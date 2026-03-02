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

export const addDocument = async (file, text, embeddingModel = 'nomic-embed-text', ollamaHost = 'http://192.168.0.136:11434') => {
    const db = await initDB();
    const docId = uuidv4();

    console.log(`[RAG] Processing ${file.name}: ${text.length} chars`);

    // Split into chunks
    const chunks = text.split(/\n\s*\n/).filter(p => p.trim())
        .flatMap(para => {
            if (para.length < 1000) return [para];
            return para.match(/.{1,1000}/g) || [para];
        });

    console.log(`[RAG] Created ${chunks.length} chunks`);

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
            
            const response = await fetch(`${ollamaHost}/api/embeddings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: embeddingModel,
                    prompt: chunk
                })
            });

            if (!response.ok) {
                throw new Error(`Embedding failed: ${response.statusText}`);
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

export const searchKnowledgeBase = async (query, model = 'nomic-embed-text', topK = 5, ollamaHost = 'http://192.168.0.136:11434') => {
    const db = await initDB();

    // Generate query embedding
    const response = await fetch(`${ollamaHost}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: model,
            prompt: query
        })
    });

    if (!response.ok) {
        throw new Error(`Query embedding failed: ${response.statusText}`);
    }

    const data = await response.json();
    const queryEmbedding = data.embedding;

    if (!queryEmbedding) {
        return [];
    }

    // Get all vectors and compute similarity
    const allVectors = await db.getAll(VECTOR_STORE_NAME);

    const results = allVectors.map(vec => ({
        ...vec,
        score: cosineSimilarity(queryEmbedding, vec.vector)
    }));

    results.sort((a, b) => b.score - a.score);

    return results.slice(0, topK);
};
