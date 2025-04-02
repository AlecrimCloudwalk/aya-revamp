// Wrapper for processing tools consistently across the application
const { executeTool } = require('./orchestrator');
const logger = require('./toolUtils/logger.js');


/**
 * Processes a tool call with consistent logging and tracking
 * 
 * @param {string} toolName - Name of the tool to execute
 * @param {Object} toolArgs - Arguments for the tool
 * @param {Object} threadState - Current thread state
 * @returns {Promise<Object>} Standardized tool result
 */
async function processTool(toolName, toolArgs, threadState) {
  // Strip any functions. prefix if it exists
  const cleanToolName = toolName.replace(/^functions\./, '');
  
  logger.info(`Processing tool: ${cleanToolName}`);
  
  // Use our standardized executeTool function
  try {
    const result = await executeTool(cleanToolName, toolArgs, threadState);
    return {
      success: true,
      toolName: cleanToolName,
      response: result,
      timestamp: new Date().toISOString(),
      error: null
    };
  } catch (error) {
    return {
      success: false,
      toolName: cleanToolName,
      response: null,
      timestamp: new Date().toISOString(),
      error: error.message
    };
  }
}

/**
 * Formats a tool response for storage or display
 * 
 * @param {Object} toolResult - The result from processTool
 * @returns {Object} Formatted tool result with useful metadata
 */
function formatToolResponse(toolResult) {
  // Add any additional formatting needed
  return {
    ...toolResult,
    formattedTimestamp: new Date(toolResult.timestamp).toLocaleString(),
    status: toolResult.error ? 'Failed' : 'Success'
  };
}

module.exports = {
  processTool,
  formatToolResponse
}; 