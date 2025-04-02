/**
 * Process LLM Feedback Tool
 * 
 * This tool processes feedback stored in the thread state, such as button clicks,
 * and provides a summary to the LLM. This helps the LLM understand recent actions
 * and provide appropriate responses.
 */
const logger = require('../toolUtils/logger');

/**
 * Process feedback stored in the thread state
 * @param {Object} args - Arguments from the LLM
 * @param {Object} threadState - Current thread state
 * @returns {Object} - Result with processed feedback
 */
async function processLLMFeedback(args, threadState) {
  try {
    const startTime = Date.now();
    logger.detail('🔄 Processing LLM feedback');
    
    // Default return structure
    const result = {
      success: true,
      feedbackCount: 0,
      buttonSelections: 0,
      latestButtonSelection: null,
      timeMs: 0
    };
    
    // Ensure llmFeedback array exists
    if (!threadState.llmFeedback) {
      threadState.llmFeedback = [];
    }
    
    // Log what we found
    logger.info(`📋 Found ${threadState.llmFeedback.length} feedback items in thread state:`);
    
    // Count feedback by type
    let buttonSelections = 0;
    let latestButtonFeedback = null;
    
    // Process each feedback item
    threadState.llmFeedback.forEach((item, index) => {
      logger.detail(`- Feedback ${index + 1}: Type=${item.type}, Message="${item.message}"`);
      
      // Count button selections
      if (item.type === 'buttonSelected') {
        buttonSelections++;
        
        // Track latest button selection (assumes they are in chronological order)
        if (!latestButtonFeedback || new Date(item.timestamp) > new Date(latestButtonFeedback.timestamp)) {
          latestButtonFeedback = item;
        }
      }
    });
    
    // Update result counts
    result.feedbackCount = threadState.llmFeedback.length;
    result.buttonSelections = buttonSelections;
    
    // Log what we found
    logger.info(`📲 Found ${buttonSelections} button selection feedback items`);
    
    // Add detailed information about latest button selection
    if (latestButtonFeedback) {
      logger.detail(`Most recent button selection: "${latestButtonFeedback.message}"`);
      result.latestButtonSelection = {
        text: latestButtonFeedback.data?.buttonText || 'Unknown button',
        value: latestButtonFeedback.data?.buttonValue || 'unknown',
        timestamp: latestButtonFeedback.timestamp,
        message: latestButtonFeedback.message
      };
    }
    
    // Calculate processing time
    result.timeMs = Date.now() - startTime;
    
    return result;
  } catch (error) {
    logger.error(`Error processing LLM feedback: ${error.message}`);
    return {
      success: false,
      error: error.message,
      feedbackCount: 0,
      buttonSelections: 0
    };
  }
}

module.exports = processLLMFeedback; 