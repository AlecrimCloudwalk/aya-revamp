// Signals the end of a conversation loop

/**
 * Tool to indicate the conversation is complete
 * @param {Object} args - Arguments
 * @param {string} [args.summary] - Optional summary or final thoughts
 * @param {string} [args.reasoning] - Reasoning for ending the conversation at top level
 * @param {Object} conversationState - Current conversation state
 * @returns {Object} - Success response
 */
async function finishRequest(args = {}, conversationState) {
  // Handle nested parameters structure
  if (args.parameters && !args.summary) {
    console.log('Detected nested parameters structure, extracting inner parameters');
    args = args.parameters;
  }
  
  // Extract the top-level reasoning (no need to filter it out)
  const reasoning = args.reasoning;
  
  // Filter out non-standard fields that shouldn't be included in the response
  const validFields = ['summary'];
  
  const filteredArgs = {};
  for (const key of validFields) {
    if (args[key] !== undefined) {
      filteredArgs[key] = args[key];
    }
  }
  
  // Log any filtered fields for debugging (excluding reasoning which we've already handled)
  const filteredKeys = Object.keys(args)
    .filter(key => !validFields.includes(key) && key !== 'reasoning');
  if (filteredKeys.length > 0) {
    console.log(`Filtered out non-standard fields: ${filteredKeys.join(', ')}`);
  }
  
  // Get the summary if provided
  const { summary } = filteredArgs;
  
  // We could do additional cleanup here if needed
  // For example:
  // - Log conversation stats
  // - Send analytics events
  // - Save completed conversation to database
  
  // For now, just return a simple success message
  return {
    complete: true,
    timestamp: new Date().toISOString(),
    summary: summary || 'Request completed',
    reasoning // Include the reasoning in the response for logging
  };
}

module.exports = {
  finishRequest
}; 