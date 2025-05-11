/**
 * Content Generator for RAG Architecture
 * Handles LLM interactions for generating content based on retrieved contexts
 */

const { Configuration, OpenAIApi } = require('openai');

class ContentGenerator {
  constructor() {
    // Initialize OpenAI API if available
    this.openai = null;
    
    if (process.env.OPENAI_API_KEY) {
      const configuration = new Configuration({
        apiKey: process.env.OPENAI_API_KEY,
      });
      this.openai = new OpenAIApi(configuration);
      console.log('[LOG content_generator] ========= OpenAI API initialized');
    } else {
      console.log('[LOG content_generator] ========= No OpenAI API key found, using mock content generation');
    }
    
    // Default system prompt for RAG responses
    this.defaultSystemPrompt = 
      'You are a helpful assistant that answers questions based on the context provided. ' +
      'Your job is to provide accurate, helpful information from the context. ' +
      'If the context doesn\'t contain information to answer the question, say "I don\'t have enough information to answer this question." ' +
      'Do not make up information or use knowledge outside of the provided context.';
  }

  /**
   * Generates a response based on user query and retrieved contexts
   * @param {string} query - User query
   * @param {Array<Object>} contexts - Retrieved context documents
   * @param {Object} options - Generation options
   * @returns {Promise<string>} - Generated response
   */
  async generateResponse(query, contexts = [], options = {}) {
    try {
      // If no OpenAI API key is available, use mock response
      if (!this.openai) {
        return this._generateMockResponse(query, contexts);
      }

      // Extract options with defaults
      const { 
        model = 'gpt-3.5-turbo',
        systemPrompt = this.defaultSystemPrompt,
        temperature = 0.7,
        maxTokens = 500,
        timeoutMs = 30000 
      } = options;

      // Extract content from contexts
      const contextText = contexts.map(ctx => {
        return `CONTEXT: ${ctx.content}\n`;
      }).join('\n');

      // Create messages array for the chat completion
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${contextText}\n\nQUESTION: ${query}\n\nPlease provide a response based on the above context.` }
      ];

      console.log(`[LOG content_generator] ========= Generating response for query: "${query}" with ${contexts.length} contexts`);
      
      // Create a timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`LLM request timed out after ${timeoutMs}ms`)), timeoutMs);
      });
      
      // Create the completion request promise
      const completionPromise = this.openai.createChatCompletion({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      });
      
      // Race the promises to implement a timeout
      const response = await Promise.race([completionPromise, timeoutPromise]);
      
      const generatedText = response.data.choices[0].message.content.trim();
      console.log(`[LOG content_generator] ========= Response generated successfully (${generatedText.length} chars)`);
      
      return generatedText;
    } catch (error) {
      console.error('[LOG content_generator] ========= Error generating response:', error);
      // Fallback to mock response in case of error
      return this._generateMockResponse(query, contexts);
    }
  }

  /**
   * Generates a mock response for development/testing
   * @param {string} query - User query
   * @param {Array<Object>} contexts - Retrieved context documents
   * @returns {string} - Mock response
   */
  _generateMockResponse(query, contexts = []) {
    console.log(`[LOG content_generator] ========= Generating mock response for: "${query}"`);
    
    if (contexts.length === 0) {
      return "I don't have enough information to answer this question as no context was provided.";
    }
    
    // Create a simple but plausible response based on the contexts
    let response = `Based on the information I have, I can tell you that `;
    
    // Extract a few sentences from the contexts
    const contextSamples = contexts.slice(0, 2).map(ctx => {
      const sentences = ctx.content.split(/[.!?]+/).filter(s => s.trim().length > 0);
      return sentences.slice(0, 2).join('. ') + '.';
    });
    
    response += contextSamples.join(' Furthermore, ');
    
    // Add a disclaimer
    response += ` This information is directly based on the context provided. Is there anything specific about this you'd like me to elaborate on?`;
    
    return response;
  }
}

// Singleton instance
const contentGenerator = new ContentGenerator();
module.exports = contentGenerator; 