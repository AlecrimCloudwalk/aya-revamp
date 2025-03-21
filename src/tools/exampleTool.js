// Example tool to demonstrate how to implement custom tools
const { logError } = require('../errors.js');

/**
 * An example tool that demonstrates how to implement a custom tool
 * @param {Object} args - Tool arguments
 * @param {string} args.input - Input data for the operation
 * @param {string} args.operation - Operation to perform (analyze, generate, transform)
 * @param {Object} conversationState - Current conversation state
 * @returns {Promise<Object>} - Operation result
 */
async function exampleTool(args, conversationState) {
  try {
    const { input, operation } = args;
    
    // Validate required arguments
    if (!input) {
      throw new Error('Input is required');
    }
    
    if (!operation) {
      throw new Error('Operation is required');
    }
    
    // Get user info from conversation context
    const { userId } = conversationState.context;
    
    // Simulate different operations
    let result;
    switch (operation.toLowerCase()) {
      case 'analyze':
        // Simulate analyzing the input
        result = {
          type: 'analysis',
          wordCount: input.split(/\s+/).length,
          sentiment: getSentiment(input),
          keywords: getKeywords(input)
        };
        break;
        
      case 'generate':
        // Simulate generating content based on input
        result = {
          type: 'generation',
          original: input,
          generated: transformInput(input, 'expand')
        };
        break;
        
      case 'transform':
        // Simulate transforming the input
        result = {
          type: 'transformation',
          original: input,
          transformed: transformInput(input, 'transform')
        };
        break;
        
      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }
    
    // Add some metadata
    return {
      success: true,
      operation,
      timestamp: new Date().toISOString(),
      userId,
      result
    };
  } catch (error) {
    logError('Error in example tool', error, { args });
    throw error;
  }
}

/**
 * Helper: Simulates sentiment analysis
 * @param {string} text - Text to analyze
 * @returns {string} - Sentiment (positive, neutral, negative)
 */
function getSentiment(text) {
  // This is a dummy implementation
  const positiveWords = ['good', 'great', 'excellent', 'happy', 'like', 'love'];
  const negativeWords = ['bad', 'terrible', 'sad', 'hate', 'dislike'];
  
  const lowerText = text.toLowerCase();
  
  let positiveCount = 0;
  let negativeCount = 0;
  
  positiveWords.forEach(word => {
    if (lowerText.includes(word)) positiveCount++;
  });
  
  negativeWords.forEach(word => {
    if (lowerText.includes(word)) negativeCount++;
  });
  
  if (positiveCount > negativeCount) return 'positive';
  if (negativeCount > positiveCount) return 'negative';
  return 'neutral';
}

/**
 * Helper: Simulates keyword extraction
 * @param {string} text - Text to analyze
 * @returns {Array<string>} - Extracted keywords
 */
function getKeywords(text) {
  // This is a dummy implementation
  const words = text.toLowerCase().split(/\W+/).filter(word => word.length > 3);
  const stopWords = ['this', 'that', 'with', 'from', 'have', 'were', 'what', 'when', 'where', 'which'];
  
  // Filter out stop words and duplicates
  return [...new Set(words.filter(word => !stopWords.includes(word)))].slice(0, 5);
}

/**
 * Helper: Simulates text transformation
 * @param {string} text - Text to transform
 * @param {string} type - Type of transformation
 * @returns {string} - Transformed text
 */
function transformInput(text, type) {
  // This is a dummy implementation
  switch (type) {
    case 'expand':
      return `${text} Additionally, this expanded version provides more context and details.`;
      
    case 'transform':
      return text.split('').reverse().join('');
      
    default:
      return text;
  }
}

module.exports = {
  exampleTool
}; 