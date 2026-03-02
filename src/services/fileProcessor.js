import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export const parseFile = async (file, ocrModel = 'deepseek-ocr:latest', ollamaHost = 'http://192.168.0.136:11434', onProgress) => {
    const fileType = file.type;
    const fileName = file.name.toLowerCase();

    try {
        if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
            return await parsePDF(file, ocrModel, ollamaHost, onProgress);
        } else if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || fileName.endsWith('.docx')) {
            return await parseDOCX(file);
        } else if (fileType === 'text/plain' || fileName.endsWith('.txt') || fileName.endsWith('.md')) {
            return await parseText(file);
        } else if (fileType.startsWith('image/') || fileName.endsWith('.png') || fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') || fileName.endsWith('.webp')) {
            return await parseImage(file, ocrModel, ollamaHost, onProgress);
        } else {
            throw new Error('Unsupported file type');
        }
    } catch (error) {
        console.error('Error parsing file:', error);
        throw error;
    }
};

const parseImage = async (file, ocrModel, ollamaHost, onProgress) => {
    console.log(`[OCR] Processing image: ${file.name}`);
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const img = new Image();
            img.onload = async () => {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    ctx.drawImage(img, 0, 0);
                    
                    const base64Image = canvas.toDataURL('image/png').split(',')[1];
                    console.log(`[OCR] Image prepared (${img.width}x${img.height}). Sending to ${ocrModel}...`);
                    
                    const text = await runOCR(ocrModel, base64Image, ollamaHost, onProgress);
                    resolve(text);
                } catch (err) {
                    reject(err);
                }
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
};

const parsePDF = async (file, ocrModel, ollamaHost, onProgress) => {
    console.log(`[PDF] Starting extraction for: ${file.name}`);
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let fullText = '';
    let hasNativeText = false;

    // First attempt: Native text extraction
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item) => item.str).join(' ');
        if (pageText.trim()) {
            hasNativeText = true;
            fullText += pageText + '\n';
        }
    }

    // Fallback: OCR for scanned PDFs
    if (!hasNativeText || fullText.trim().length < 50) {
        console.log(`[OCR] No searchable text found in PDF. Falling back to OCR for ${pdf.numPages} pages...`);
        fullText = '';
        
        for (let i = 1; i <= pdf.numPages; i++) {
            if (onProgress) onProgress(`Rendering PDF page ${i}/${pdf.numPages}...`);
            const page = await pdf.getPage(i);
            
            const viewport = page.getViewport({ scale: 2.0 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({ canvasContext: context, viewport }).promise;
            const base64Image = canvas.toDataURL('image/png').split(',')[1];
            
            console.log(`[OCR] Page ${i} rendered (${canvas.width}x${canvas.height}). Sending to OCR...`);
            if (onProgress) onProgress(`OCR processing page ${i}/${pdf.numPages}...`);
            
            try {
                const pageText = await runOCR(ocrModel, base64Image, ollamaHost, (charCount) => {
                    if (onProgress) onProgress(`OCR page ${i}: ${charCount} chars...`);
                });
                fullText += pageText + '\n';
                console.log(`[OCR] Page ${i} completed. ${pageText.length} chars.`);
            } catch (ocrErr) {
                console.error(`[OCR] Page ${i} failed:`, ocrErr);
                fullText += `\n[Error processing page ${i}: ${ocrErr.message}]\n`;
            }
        }
    }

    return fullText;
};

const parseDOCX = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
};

const parseText = async (file) => {
    return await file.text();
};

const runOCR = async (ocrModel, base64Image, ollamaHost, onProgress) => {
    console.log(`[OCR v2.4] Starting OCR with model: ${ocrModel}`);
    
    const response = await fetch(`${ollamaHost}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: ocrModel,
            messages: [{
                role: 'user',
                content: 'Extract all text from this image exactly as it appears.',
                images: [base64Image]
            }],
            stream: true
        })
    });

    if (!response.ok) {
        throw new Error(`OCR request failed: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
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
                    fullText += json.message.content;
                    
                    if (isFirstChunk && onProgress) {
                        onProgress(fullText.length);
                        isFirstChunk = false;
                    } else if (onProgress) {
                        onProgress(fullText.length);
                    }
                }
            } catch (e) {
                // Skip invalid JSON
            }
        }
    }

    console.log(`[OCR] Completed. Total chars: ${fullText.length}`);
    return fullText;
};
