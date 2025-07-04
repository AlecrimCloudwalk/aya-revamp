// Signals the end of a conversation loop
const { getSlackClient } = require('../slackClient.js');
const logger = require('../toolUtils/logger.js');


/**
 * Tool to indicate the conversation is complete
 * @param {Object} args - Arguments
 * @param {string} [args.summary] - Optional summary or final thoughts
 * @param {string} [args.reasoning] - Reasoning for ending the conversation at top level
 * @param {boolean} [args.clearCache] - Whether to clear the thread history cache
 * @param {Object} threadState - Current thread state
 * @returns {Object} - Success response
 */
async function finishRequest(args = {}, threadState) {
  // Handle nested parameters structure
  if (args.parameters && !args.summary) {
    logger.info('Detected nested parameters structure, extracting inner parameters');
    args = args.parameters;
  }
  
  // Extract the top-level reasoning (no need to filter it out)
  const reasoning = args.reasoning;
  
  // Filter out non-standard fields that shouldn't be included in the response
  const validFields = ['summary', 'clearCache'];
  
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
    logger.info(`Filtered out non-standard fields: ${filteredKeys.join(', ')}`);
  }
  
  // Get the summary and clearCache flag if provided
  const { summary, clearCache = false } = filteredArgs;
  
  // If clearCache is true, clear the thread history cache for this thread
  if (clearCache && threadState && threadState.threadId) {
    try {
      // Import the threadHistoryCache from getThreadHistory.js
      const getThreadHistoryModule = require('./getThreadHistory.js');
      
      // Check if the module exports the cache
      if (getThreadHistoryModule.clearThreadCache) {
        getThreadHistoryModule.clearThreadCache(threadState.threadId);
        logger.info(`Thread history cache cleared for thread ${threadState.threadId}`);
      } else {
        logger.warn('clearThreadCache function not found in getThreadHistory module');
      }
    } catch (cacheError) {
      logger.warn(`Error clearing thread history cache: ${cacheError.message}`);
    }
  }
  
  // Check if this finishRequest is being called after a button interaction
  // by looking for button selection info in the thread state
  if (threadState.lastButtonSelection) {
    logger.info(`Request finished with finishRequest tool after button selection`);
    
    // Try to find the message that had the button
    const buttonMessageTs = threadState.lastButtonSelection.messageTs || 
                           (threadState.lastButtonUpdate && threadState.lastButtonUpdate.messageTs);
    
    if (buttonMessageTs) {
      // Get the channel from context metadata
      const context = threadState.getMetadata('context');
      const channelId = context?.channelId || threadState.getChannel();
      
      if (channelId) {
        // Try to ensure we've removed the loading reaction and added a success reaction
        try {
          const slackClient = getSlackClient();
          
          // First try to remove loading reaction if it exists
          try {
            await slackClient.reactions.remove({
              channel: channelId,
              timestamp: buttonMessageTs,
              name: 'loading'
            });
            logger.info(`Removed loading reaction from button message`);
          } catch (removeError) {
            // Not critical if it fails
            logger.warn(`Note: Could not remove loading reaction: ${removeError.message}`);
          }
          
          // Then add success reaction
          try {
            await slackClient.reactions.add({
              channel: channelId,
              timestamp: buttonMessageTs,
              name: 'white_check_mark'
            });
            logger.info(`Added success reaction to button message`);
          } catch (addError) {
            // If this fails with "already_reacted", that's okay
            if (!addError.message.includes('already_reacted')) {
              logger.warn(`Could not add success reaction: ${addError.message}`);
            }
          }
        } catch (reactionError) {
          logger.warn(`Error handling button reactions: ${reactionError.message}`);
        }
      }
    }
  } else {
    logger.info(`Request finished with finishRequest tool`);
  }
  
  // Return a success message
  return {
    complete: true,
    timestamp: new Date().toISOString(),
    summary: summary || 'Request completed',
    reasoning
  };
}

module.exports = {
  finishRequest
}; 