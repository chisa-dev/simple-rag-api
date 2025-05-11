/**
 * Status Routes
 * Endpoints for checking system status
 */

const express = require('express');
const router = express.Router();
const ragService = require('../services/ragService');

/**
 * @swagger
 * /api/status:
 *   get:
 *     summary: Get system status
 *     description: Returns the current status of the RAG system including vector store and LLM availability
 *     tags: [Status]
 *     responses:
 *       200:
 *         description: System status information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   description: Whether the request was successful
 *                 status:
 *                   type: object
 *                   properties:
 *                     qdrantConnected:
 *                       type: boolean
 *                       description: Whether the vector store is connected
 *                     openaiAvailable:
 *                       type: boolean
 *                       description: Whether the OpenAI API is available
 *                     globalCollection:
 *                       type: object
 *                       properties:
 *                         name:
 *                           type: string
 *                           description: Name of the global collection
 *                         exists:
 *                           type: boolean
 *                           description: Whether the collection exists
 *                         vectorCount:
 *                           type: integer
 *                           description: Number of vectors in the collection
 *                     indexedDocuments:
 *                       type: array
 *                       items:
 *                         type: object
 *                       description: List of indexed documents
 *       500:
 *         description: Error getting system status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   description: Error message
 */
router.get('/status', async (req, res) => {
  try {
    const status = await ragService.getSystemStatus();
    res.json(status);
  } catch (error) {
    console.error('[LOG status_routes] ========= Error getting system status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router; 