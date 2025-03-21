// Signals the end of a conversation loop

/**
 * Tool to indicate the conversation is complete
 * @param {Object} args - Arguments
 * @param {string} [args.summary] - Optional summary or final thoughts
 * @param {Object} conversationState - Current conversation state
 * @returns {Object} - Success response
 */
async function finishRequest(args = {}, conversationState) {
  // Get the summary if provided
  const { summary } = args;
  
  // We could do additional cleanup here if needed
  // For example:
  // - Log conversation stats
  // - Send analytics events
  // - Save completed conversation to database
  
  // For now, just return a simple success message
  return {
    complete: true,
    timestamp: new Date().toISOString(),
    summary: summary || 'Request completed'
  };
}

module.exports = {
  finishRequest
}; 