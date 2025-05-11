/**
 * RAG Service
 * Coordinates the RAG workflow: processing documents, storing vectors, and generating responses
 */

const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const unlinkAsync = promisify(fs.unlink);
const { v4: uuidv4 } = require('uuid');

const documentProcessor = require('../utils/documentProcessor');
const vectorStore = require('../utils/vectorStore');
const contentGenerator = require('../utils/contentGenerator');

// Global collection for all documents
const GLOBAL_COLLECTION_NAME = 'global_documents';

// In-memory storage for indexed documents
const indexedDocuments = new Map();

/**
 * Performs the RAG indexing process
 * @param {Object} file - The uploaded file object
 * @returns {Promise<Object>} - Status and info
 */
const indexDocument = async (file) => {
  try {
    console.log(`[LOG rag_service] ========= Starting indexing for file: ${file.originalname}`);
    
    // Determine file type from extension
    const fileExtension = path.extname(file.originalname).toLowerCase().substring(1);
    let fileType;
    
    switch (fileExtension) {
      case 'pdf':
        fileType = 'pdf';
        break;
      case 'docx':
      case 'doc':
        fileType = 'docx';
        break;
      case 'jpg':
      case 'jpeg':
      case 'png':
        fileType = 'image';
        break;
      case 'ppt':
      case 'pptx':
        fileType = 'ppt';
        break;
      case 'txt':
        fileType = 'text';
        break;
      default:
        fileType = 'text';
    }
    
    // Generate a document ID
    const documentId = uuidv4();
    
    // Create metadata for the file
    const metadata = {
      source_file: file.originalname,
      file_type: fileType,
      created_at: new Date().toISOString(),
      document_id: documentId
    };
    
    // Process the file - extract text, chunk, and generate embeddings
    console.log(`[LOG rag_service] ========= Processing ${fileType} file: ${file.path}`);
    const processedDocuments = await documentProcessor.processFile(file.path, fileType, metadata);
    console.log(`[LOG rag_service] ========= Generated ${processedDocuments.length} chunks with embeddings`);
    
    // Store vectors in Qdrant
    console.log(`[LOG rag_service] ========= Storing vectors in collection: ${GLOBAL_COLLECTION_NAME}`);
    const storeResult = await vectorStore.addDocuments(GLOBAL_COLLECTION_NAME, processedDocuments);
    
    // Delete the temporary file after processing
    try {
      await unlinkAsync(file.path);
      console.log(`[LOG rag_service] ========= Temporary file deleted: ${file.path}`);
    } catch (err) {
      console.error(`[LOG rag_service] ========= Error deleting temporary file:`, err);
    }
    
    // Store document info in memory
    indexedDocuments.set(documentId, {
      documentId,
      chunksCount: processedDocuments.length,
      filename: file.originalname,
      fileType,
      createdAt: new Date().toISOString()
    });
    
    return {
      success: true,
      documentId,
      collectionName: GLOBAL_COLLECTION_NAME,
      documentCount: processedDocuments.length,
      filename: file.originalname
    };
  } catch (error) {
    console.error('[LOG rag_service] ========= Error indexing document:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Generates a chat response using the RAG approach
 * @param {string} query - User query
 * @returns {Promise<Object>} - Response and context info
 */
const generateChatResponse = async (query) => {
  try {
    console.log(`[LOG rag_service] ========= Generating chat response for query: "${query}"`);
    
    // Generate embedding for the query
    console.log(`[LOG rag_service] ========= Generating embedding for query`);
    const queryEmbedding = await documentProcessor.generateEmbedding(query);
    
    // Default search options
    const limit = 5;
    const minScore = 0.7;
    
    // Search in the global collection
    console.log(`[LOG rag_service] ========= Searching in global collection: ${GLOBAL_COLLECTION_NAME}`);
    let searchResults = [];
    
    try {
      searchResults = await vectorStore.search(
        GLOBAL_COLLECTION_NAME,
        queryEmbedding,
        limit,
        minScore
      );
      
      console.log(`[LOG rag_service] ========= Found ${searchResults.length} relevant documents`);
    } catch (err) {
      console.error(`[LOG rag_service] ========= Error searching: ${err.message}`);
      // Return empty results if collection doesn't exist yet
      searchResults = [];
    }
    
    // Generate response based on search results
    console.log(`[LOG rag_service] ========= Generating response using content generator`);
    const response = await contentGenerator.generateResponse(query, searchResults);
    
    return {
      success: true,
      query,
      response,
      contexts: searchResults.map(doc => ({
        content: doc.content,
        score: doc.score,
        source: doc.metadata?.source_file || 'Unknown'
      }))
    };
  } catch (error) {
    console.error('[LOG rag_service] ========= Error generating chat response:', error);
    return {
      success: false,
      query,
      error: error.message,
      response: "I'm sorry, I encountered an error processing your query. Please try again."
    };
  }
};

/**
 * Gets status information about the RAG system
 * @returns {Promise<Object>} - Status info
 */
const getSystemStatus = async () => {
  try {
    console.log(`[LOG rag_service] ========= Getting system status`);
    
    // Get Qdrant status
    const qdrantStatus = vectorStore.initialized;
    
    // Check OpenAI availability
    const openaiAvailable = !!process.env.OPENAI_API_KEY;
    
    // Get document count
    let documentCount = 0;
    let collectionExists = false;
    
    try {
      const collectionInfo = await vectorStore.getCollection(GLOBAL_COLLECTION_NAME);
      if (collectionInfo) {
        documentCount = collectionInfo.vectors_count || 0;
        collectionExists = true;
      }
    } catch (err) {
      // Collection might not exist yet
      documentCount = 0;
    }
    
    return {
      success: true,
      status: {
        qdrantConnected: qdrantStatus,
        openaiAvailable,
        globalCollection: {
          name: GLOBAL_COLLECTION_NAME,
          exists: collectionExists,
          vectorCount: documentCount
        },
        indexedDocuments: Array.from(indexedDocuments.values())
      }
    };
  } catch (error) {
    console.error('[LOG rag_service] ========= Error getting system status:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

module.exports = {
  indexDocument,
  generateChatResponse,
  getSystemStatus
}; 