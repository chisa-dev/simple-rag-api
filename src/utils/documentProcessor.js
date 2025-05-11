/**
 * Document Processor for RAG Architecture
 * Handles text extraction, chunking, and embedding generation
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const readFileAsync = promisify(fs.readFile);
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { v4: uuidv4 } = require('uuid');
const { Configuration, OpenAIApi } = require('openai');

// Initialize OpenAI configuration if API key is available
let openai = null;
if (process.env.OPENAI_API_KEY) {
  const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
  });
  openai = new OpenAIApi(configuration);
}

/**
 * Extracts text content from various file types
 * @param {string} filePath - Path to the file
 * @param {string} fileType - Type of the file (pdf, docx, etc.)
 * @returns {Promise<string>} - Extracted text content
 */
const extractTextFromFile = async (filePath, fileType) => {
  try {
    switch (fileType) {
      case 'pdf':
        const pdfBuffer = await readFileAsync(filePath);
        const pdfData = await pdfParse(pdfBuffer);
        return pdfData.text;
      case 'docx':
        const docxBuffer = await readFileAsync(filePath);
        const docxResult = await mammoth.extractRawText({ buffer: docxBuffer });
        return docxResult.value;
      case 'image':
        // For images, return file reference (OCR could be implemented in the future)
        return `[Image: ${path.basename(filePath)}]`;
      case 'ppt':
        // PPT extraction would require additional libraries
        return `[PowerPoint: ${path.basename(filePath)}]`;
      default:
        return `[Unsupported file type: ${fileType}]`;
    }
  } catch (error) {
    console.error(`[LOG document_processor] ========= Error extracting text from ${filePath}:`, error);
    return `[Error extracting content from file: ${path.basename(filePath)}]`;
  }
};

/**
 * Splits text into chunks of specified size with overlap
 * @param {string} text - Text to split into chunks
 * @param {number} chunkSize - Maximum number of characters per chunk
 * @param {number} overlap - Number of characters to overlap between chunks
 * @returns {Array<{id: string, content: string, metadata: Object}>} - Array of chunks
 */
const splitTextIntoChunks = (text, chunkSize = 1000, overlap = 200, metadata = {}) => {
  if (!text || text.length === 0) {
    return [];
  }

  // Split by paragraphs first to maintain coherence
  const paragraphs = text.split(/\n\s*\n/);
  const chunks = [];
  let currentChunk = '';
  
  for (const paragraph of paragraphs) {
    // If adding this paragraph would exceed chunk size, store current chunk and start a new one
    if (currentChunk.length + paragraph.length > chunkSize && currentChunk.length > 0) {
      chunks.push({
        id: uuidv4(),
        content: currentChunk.trim(),
        metadata: { ...metadata }
      });
      // Start new chunk with overlap from the end of the previous chunk
      const overlapText = currentChunk.length > overlap 
        ? currentChunk.slice(-overlap) 
        : currentChunk;
      currentChunk = overlapText + " " + paragraph;
    } else {
      // Add the paragraph to the current chunk
      currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
    }
  }

  // Add the last chunk if it's not empty
  if (currentChunk.trim().length > 0) {
    chunks.push({
      id: uuidv4(),
      content: currentChunk.trim(),
      metadata: { ...metadata }
    });
  }

  return chunks;
};

/**
 * Generates a mock embedding vector for development/testing
 * @param {number} dimensions - Number of dimensions for the embedding
 * @returns {Array<number>} - Mock embedding vector
 */
const generateMockEmbedding = (dimensions = 1536) => {
  console.log(`[LOG document_processor] ========= Generating mock embedding (${dimensions} dimensions)`);
  const embedding = new Array(dimensions).fill(0).map(() => Math.random() * 2 - 1);
  
  // Normalize the embedding vector
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  return embedding.map(val => val / magnitude);
};

/**
 * Generates embeddings for text using OpenAI API with retry mechanism
 * @param {string} text - Text to embed
 * @param {number} retries - Number of retries (default: 3)
 * @param {number} timeoutMs - Timeout in milliseconds (default: 10000)
 * @returns {Promise<Array<number>>} - Embedding vector
 */
const generateEmbedding = async (text, retries = 3, timeoutMs = 10000) => {
  let lastError = null;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // If OpenAI API key is not available, use mock embeddings
      if (!openai) {
        console.log('[LOG document_processor] ========= No OpenAI API key found, using mock embeddings');
        return generateMockEmbedding();
      }
      
      console.log(`[LOG document_processor] ========= Generating embedding attempt ${attempt}/${retries}`);
      
      // Create a timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Embedding request timed out after ${timeoutMs}ms`)), timeoutMs);
      });
      
      // Create the embedding request promise
      const embedPromise = openai.createEmbedding({
        model: 'text-embedding-ada-002',
        input: text.trim().replace(/\n+/g, ' ').slice(0, 8000), // Truncate to prevent token limit errors
      });
      
      // Race the promises to implement a timeout
      const response = await Promise.race([embedPromise, timeoutPromise]);
      
      console.log(`[LOG document_processor] ========= Embedding generation successful`);
      return response.data.data[0].embedding;
    } catch (error) {
      lastError = error;
      
      // Check if this is a rate limit error
      const isRateLimit = error.message && (
        error.message.includes('rate limit') || 
        error.message.includes('429') ||
        error.message.includes('too many requests')
      );
      
      console.error(`[LOG document_processor] ========= Error generating embedding (attempt ${attempt}/${retries}):`, 
        isRateLimit ? 'Rate limit exceeded' : error.message);
      
      // If it's the last retry, fall back to mock embeddings
      if (attempt === retries) {
        console.log('[LOG document_processor] ========= Falling back to mock embeddings after failed retries');
        return generateMockEmbedding();
      }
      
      // Wait before retrying (exponential backoff)
      // Wait longer for rate limit errors
      const baseWaitTime = isRateLimit ? 2000 : 1000;
      const waitTime = Math.min(baseWaitTime * Math.pow(2, attempt - 1), 15000);
      console.log(`[LOG document_processor] ========= Waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  // This should never be reached due to the mock fallback in the last retry
  return generateMockEmbedding();
};

/**
 * Processes a file into chunks with embeddings
 * @param {string} filePath - Path to the file
 * @param {string} fileType - Type of the file
 * @param {Object} metadata - Metadata to associate with chunks
 * @param {number} maxChunks - Maximum number of chunks to process (default: 25)
 * @returns {Promise<Array<Object>>} - Array of chunks with embeddings
 */
const processFile = async (filePath, fileType, metadata = {}, maxChunks = 25) => {
  try {
    console.log(`[LOG document_processor] ========= Starting document processing for ${filePath}`);
    const startTime = Date.now();
    
    // Extract text from file
    console.log(`[LOG document_processor] ========= Extracting text from ${fileType} file`);
    const text = await extractTextFromFile(filePath, fileType);
    console.log(`[LOG document_processor] ========= Text extraction completed in ${(Date.now() - startTime)/1000}s`);
    
    // Split text into chunks
    console.log(`[LOG document_processor] ========= Splitting text into chunks`);
    const chunkStartTime = Date.now();
    let chunks = splitTextIntoChunks(text, 1000, 200, metadata);
    console.log(`[LOG document_processor] ========= Text splitting completed in ${(Date.now() - chunkStartTime)/1000}s`);
    
    // Limit the number of chunks to process for large documents
    if (chunks.length > maxChunks) {
      console.log(`[LOG document_processor] ========= Limiting chunks from ${chunks.length} to ${maxChunks}`);
      chunks = chunks.slice(0, maxChunks);
    } else {
      console.log(`[LOG document_processor] ========= Processing ${chunks.length} chunks`);
    }
    
    // Generate embeddings for each chunk
    console.log(`[LOG document_processor] ========= Starting embeddings generation for ${chunks.length} chunks`);
    const embeddingStartTime = Date.now();
    const chunksWithEmbeddings = [];
    
    // Process chunks in batches to avoid overwhelming the API
    const BATCH_SIZE = 5;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batchStartTime = Date.now();
      const batch = chunks.slice(i, Math.min(i + BATCH_SIZE, chunks.length));
      
      console.log(`[LOG document_processor] ========= Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(chunks.length/BATCH_SIZE)} (${batch.length} chunks)`);
      
      // Process each chunk in the batch
      const batchResults = await Promise.all(
        batch.map(async (chunk, index) => {
          const chunkStartTime = Date.now();
          console.log(`[LOG document_processor] ========= Generating embedding for chunk ${i + index + 1}/${chunks.length}`);
          
          try {
            const embedding = await generateEmbedding(chunk.content);
            console.log(`[LOG document_processor] ========= Embedding for chunk ${i + index + 1} completed in ${(Date.now() - chunkStartTime)/1000}s`);
            return { ...chunk, embedding };
          } catch (error) {
            console.error(`[LOG document_processor] ========= Error generating embedding for chunk ${i + index + 1}:`, error);
            // Return a mock embedding if we can't generate a real one
            return { 
              ...chunk, 
              embedding: generateMockEmbedding(),
              embeddingError: error.message 
            };
          }
        })
      );
      
      chunksWithEmbeddings.push(...batchResults);
      console.log(`[LOG document_processor] ========= Batch ${Math.floor(i/BATCH_SIZE) + 1} completed in ${(Date.now() - batchStartTime)/1000}s`);
    }
    
    console.log(`[LOG document_processor] ========= All embeddings generated in ${(Date.now() - embeddingStartTime)/1000}s`);
    console.log(`[LOG document_processor] ========= Total processing time: ${(Date.now() - startTime)/1000}s`);
    
    return chunksWithEmbeddings;
  } catch (error) {
    console.error('[LOG document_processor] ========= Error processing file:', error);
    throw error;
  }
};

module.exports = {
  extractTextFromFile,
  splitTextIntoChunks,
  generateEmbedding,
  generateMockEmbedding,
  processFile
}; 