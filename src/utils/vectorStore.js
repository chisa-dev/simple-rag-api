/**
 * Vector Store for RAG Architecture
 * Manages vector embeddings for documents and retrieval by similarity using Qdrant
 */

const { QdrantClient } = require('@qdrant/js-client-rest');
const { v4: uuidv4 } = require('uuid');

class QdrantVectorStore {
  constructor() {
    // Initialize Qdrant client with details from environment variables
    const qdrantUrl = process.env.QDRANT_URL;
    const qdrantApiKey = process.env.QDRANT_API_KEY;
    
    this.client = new QdrantClient({
      url: qdrantUrl,
      apiKey: qdrantApiKey
    });

    this.vectorSize = 1536; // Size of OpenAI embeddings
    this.initialized = false;
    this.initialize();
  }

  /**
   * Initialize the Qdrant client connection
   */
  async initialize() {
    try {
      // Verify connection
      await this.client.getCollections();
      this.initialized = true;
      console.log(`[LOG vector_store] ========= Connected to Qdrant successfully`);
    } catch (error) {
      console.error(`[LOG vector_store] ========= Error connecting to Qdrant:`, error);
    }
  }

  /**
   * Creates a new collection
   * @param {string} collectionName - Name of the collection
   * @returns {Promise<Object>} - Status and info about the collection
   */
  async createCollection(collectionName) {
    try {
      // Check if collection exists
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(c => c.name === collectionName);
      
      if (!exists) {
        // Create a new collection with appropriate settings for OpenAI embeddings
        await this.client.createCollection(collectionName, {
          vectors: {
            size: this.vectorSize,
            distance: 'Cosine'
          },
          // Define payload schema for metadata
          optimizers_config: {
            default_segment_number: 2
          },
          replication_factor: 1
        });
        console.log(`[LOG vector_store] ========= Collection ${collectionName} created`);
        return { success: true, created: true, existed: false };
      } else {
        console.log(`[LOG vector_store] ========= Collection ${collectionName} already exists`);
        return { success: true, created: false, existed: true };
      }
    } catch (error) {
      console.error(`[LOG vector_store] ========= Error creating collection ${collectionName}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate a valid Qdrant point ID from a string
   * @param {string} id - Original ID
   * @returns {string} - Valid Qdrant UUID
   */
  generatePointId(id) {
    // Convert string IDs to valid UUIDs for Qdrant
    try {
      // If it's already a valid UUID, use it
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        return id;
      }
      
      // Otherwise generate a new UUID using the string as seed
      return uuidv4();
    } catch (e) {
      // Fallback to a new random UUID
      return uuidv4();
    }
  }

  /**
   * Adds documents to the collection
   * @param {string} collectionName - Name of the collection
   * @param {Array<Object>} documents - Documents with embeddings to add
   * @returns {Promise<Object>} - Status and info
   */
  async addDocuments(collectionName, documents) {
    try {
      // Ensure collection exists
      const collectionResult = await this.createCollection(collectionName);
      if (!collectionResult.success) {
        throw new Error(`Failed to create collection: ${collectionResult.error}`);
      }
      
      // Format documents for Qdrant - ensure we have valid UUIDs for IDs
      const points = documents.map(doc => {
        // Store original ID in payload
        const originalId = doc.id;
        // Generate a valid UUID for Qdrant
        const qdrantId = this.generatePointId(originalId);
        
        return {
          id: qdrantId,
          vector: doc.embedding,
          payload: {
            original_id: originalId,
            content: doc.content,
            ...doc.metadata
          }
        };
      });
      
      // Add points in batches of 100 to prevent overwhelming the server
      const batchSize = 100;
      for (let i = 0; i < points.length; i += batchSize) {
        const batch = points.slice(i, i + batchSize);
        await this.client.upsert(collectionName, {
          wait: true,
          points: batch
        });
      }
      
      console.log(`[LOG vector_store] ========= Added ${documents.length} documents to ${collectionName}`);
      return { 
        success: true, 
        documentsAdded: documents.length,
        collectionWasCreated: collectionResult.created,
        collectionAlreadyExisted: collectionResult.existed
      };
    } catch (error) {
      console.error(`[LOG vector_store] ========= Error adding documents to ${collectionName}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Searches for similar documents with timeout protection
   * @param {string} collectionName - Name of the collection
   * @param {Array<number>} queryEmbedding - Query embedding vector
   * @param {number} limit - Maximum number of results
   * @param {number} minScore - Minimum similarity score (0-1)
   * @param {number} timeoutMs - Search timeout in milliseconds
   * @returns {Promise<Array<Object>>} - Similar documents with scores
   */
  async search(collectionName, queryEmbedding, limit = 5, minScore = 0.7, timeoutMs = 30000) {
    try {
      console.log(`[LOG vector_store] ========= Starting search in collection ${collectionName} with ${timeoutMs}ms timeout`);
      
      // Ensure collection exists
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(c => c.name === collectionName);
      
      if (!exists) {
        console.error(`[LOG vector_store] ========= Collection ${collectionName} not found`);
        return [];
      }
      
      // Create a promise that will reject after the timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Search operation timed out after ${timeoutMs}ms`)), timeoutMs);
      });
      
      // Create the search promise
      const searchPromise = this.client.search(collectionName, {
        vector: queryEmbedding,
        limit: limit,
        score_threshold: minScore
      });
      
      // Race the promises - whichever resolves/rejects first wins
      const searchResult = await Promise.race([searchPromise, timeoutPromise]);
      
      console.log(`[LOG vector_store] ========= Search completed, found ${searchResult.length} results`);
      
      // Transform results to match our interface
      return searchResult.map(result => ({
        id: result.payload.original_id || result.id,
        content: result.payload.content,
        metadata: {
          ...result.payload,
          content: undefined // Remove content from metadata as it's already in the main field
        },
        score: result.score
      }));
    } catch (error) {
      console.error(`[LOG vector_store] ========= Error searching in ${collectionName}:`, error);
      console.log('[LOG vector_store] ========= Returning empty results due to error');
      return [];
    }
  }

  /**
   * Gets a collection
   * @param {string} collectionName - Name of the collection
   * @returns {Promise<Object>} - Collection information
   */
  async getCollection(collectionName) {
    try {
      return await this.client.getCollection(collectionName);
    } catch (error) {
      console.error(`[LOG vector_store] ========= Error getting collection ${collectionName}:`, error);
      return null;
    }
  }

  /**
   * Deletes a collection
   * @param {string} collectionName - Name of the collection
   * @returns {Promise<boolean>} - Success status
   */
  async deleteCollection(collectionName) {
    try {
      await this.client.deleteCollection(collectionName);
      console.log(`[LOG vector_store] ========= Collection ${collectionName} deleted`);
      return true;
    } catch (error) {
      console.error(`[LOG vector_store] ========= Error deleting collection ${collectionName}:`, error);
      return false;
    }
  }
}

// Singleton instance
const vectorStore = new QdrantVectorStore();
module.exports = vectorStore; 