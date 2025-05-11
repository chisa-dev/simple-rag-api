/**
 * Upload Middleware
 * Ensures upload directories exist and handles file upload errors
 */

const fs = require('fs');
const path = require('path');

/**
 * Ensures the uploads directory exists
 */
const ensureUploadsDir = (req, res, next) => {
  try {
    const uploadsDir = path.join(__dirname, '../../uploads');
    
    if (!fs.existsSync(uploadsDir)) {
      console.log('[LOG upload_middleware] ========= Creating uploads directory');
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    
    next();
  } catch (error) {
    console.error('[LOG upload_middleware] ========= Error ensuring uploads directory exists:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to ensure uploads directory exists'
    });
  }
};

/**
 * Handles file upload errors
 */
const handleUploadErrors = (err, req, res, next) => {
  if (err) {
    console.error('[LOG upload_middleware] ========= File upload error:', err);
    
    // Handle file size limit exceeded
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File size limit exceeded (10MB maximum)'
      });
    }
    
    // Handle unsupported file types
    if (err.message.includes('Unsupported file type')) {
      return res.status(400).json({
        success: false,
        error: err.message
      });
    }
    
    // Handle other errors
    return res.status(500).json({
      success: false,
      error: 'File upload failed: ' + err.message
    });
  }
  
  next();
};

module.exports = {
  ensureUploadsDir,
  handleUploadErrors
}; 