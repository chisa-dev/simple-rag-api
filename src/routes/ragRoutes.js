/**
 * RAG Routes
 * Endpoints for document indexing and chat functionality
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const ragService = require('../services/ragService');
const { ensureUploadsDir, handleUploadErrors } = require('../middlewares/uploadMiddleware');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads'));
  },
  filename: (req, file, cb) => {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter to allow only supported file types
const fileFilter = (req, file, cb) => {
  // Accept PDF, DOCX, PPT, and images
  const allowedFileTypes = ['.pdf', '.docx', '.doc', '.pptx', '.ppt', '.jpg', '.jpeg', '.png', '.txt'];
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (allowedFileTypes.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Unsupported file type. Only PDF, DOCX, PPT, images, and text files are allowed.'), false);
  }
};

// Configure upload middleware
const upload = multer({ 
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB file size limit
});

/**
 * @swagger
 * /api/rag/index:
 *   post:
 *     summary: Index a document
 *     description: Upload and process a document for RAG
 *     tags: [RAG]
 *     consumes:
 *       - multipart/form-data
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - document
 *             properties:
 *               document:
 *                 type: string
 *                 format: binary
 *                 description: Document to index (PDF, DOCX, PPT, image, or text file)
 *     responses:
 *       200:
 *         description: Document indexed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   description: Whether the request was successful
 *                   example: true
 *                 collectionName:
 *                   type: string
 *                   description: Collection name in vector store
 *                 documentCount:
 *                   type: integer
 *                   description: Number of chunks indexed
 *                 filename:
 *                   type: string
 *                   description: Original filename
 *       400:
 *         description: Invalid request or file type
 *       500:
 *         description: Server error
 */
router.post('/rag/index', 
  ensureUploadsDir, 
  upload.single('document'), 
  handleUploadErrors,
  async (req, res) => {
    try {
      // Basic validation
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded'
        });
      }
      
      console.log(`[LOG rag_routes] ========= Indexing document:`, req.file.originalname);
      
      // Process the document
      const result = await ragService.indexDocument(req.file);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(500).json(result);
      }
    } catch (error) {
      console.error('[LOG rag_routes] ========= Error indexing document:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * @swagger
 * /api/rag/chat:
 *   post:
 *     summary: Generate chat response
 *     description: Generate a response based on all indexed documents
 *     tags: [RAG]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *             properties:
 *               query:
 *                 type: string
 *                 description: User query
 *     responses:
 *       200:
 *         description: Chat response generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   description: Whether the request was successful
 *                 query:
 *                   type: string
 *                   description: The original query
 *                 response:
 *                   type: string
 *                   description: Generated response
 *                 contexts:
 *                   type: array
 *                   items:
 *                     type: object
 *                   description: Contexts used for generation
 *       400:
 *         description: Invalid request parameters
 *       500:
 *         description: Server error
 */
router.post('/rag/chat', async (req, res) => {
  try {
    const { query } = req.body;
    
    // Basic validation
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query is required'
      });
    }
    
    console.log(`[LOG rag_routes] ========= Generating chat response for query: "${query}"`);
    
    // Generate response
    const result = await ragService.generateChatResponse(query);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    console.error('[LOG rag_routes] ========= Error generating chat response:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      response: "I'm sorry, I encountered an error processing your query. Please try again."
    });
  }
});

module.exports = router; 