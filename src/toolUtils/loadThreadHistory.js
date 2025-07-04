/**
 * Loads thread history from Slack into the context builder
 * This helps with rebuilding context even for pre-existing conversations
 */

const { getSlackClient } = require('../slackClient.js');
const { logError } = require('../errors.js');
const { getContextBuilder } = require('../contextBuilder.js');
const { getTool } = require('../tools/index.js');
const logger = require('./logger');
const { loadThreadHistory } = require('../tools/getThreadHistory');

/**
 * Extracts the thread timestamp and channel ID from a context object
 * @param {Object} threadContext - Context object with thread information
 * @returns {Object} Object with threadTs and channelId
 */
function extractThreadInfo(threadContext) {
    // Handle context object from ContextBuilder metadata
    if (typeof threadContext === 'object') {
        if (threadContext.threadId) {
            return {
                threadTs: threadContext.threadTs || threadContext.threadId,
                channelId: threadContext.channelId
            };
        } else if (threadContext.threadTs) {
            return {
                threadTs: threadContext.threadTs,
                channelId: threadContext.channelId || threadContext.channel
            };
        }
    }
    
    // Handle string-based threadId
    if (typeof threadContext === 'string') {
        // If it contains a dot, it's likely a thread timestamp
        if (threadContext.includes('.')) {
            return {
                threadTs: threadContext,
                channelId: null // We'll need to find this elsewhere
            };
        }
        
        // Otherwise it could be a direct message/channel ID
        return {
            threadTs: null,
            channelId: threadContext
        };
    }
    
    // Fallback - return empty object
    return {
        threadTs: null,
        channelId: null
    };
}

/**
 * Loads thread history from Slack API if the context builder is empty
 * 
 * This function checks if we have messages in the context builder already.
 * If not, it uses the Slack API to load message history and populates the context.
 * 
 * @param {string} threadId - Thread ID (either thread timestamp or channel ID for DMs)
 * @returns {Promise<void>}
 */
async function initializeContextIfNeeded(threadId) {
    // Skip if threadId is not provided
    if (!threadId) {
        logger.warn('No threadId provided for context initialization');
        return;
    }
    
    logger.info(`Initializing context for thread: ${threadId}`);
    
    try {
        // Get context builder
        const contextBuilder = getContextBuilder();
        
        // Get context from metadata
        const context = contextBuilder.getMetadata(threadId, 'context');
        
        // Extract thread info
        const threadInfo = extractThreadInfo(threadId);
        let { threadTs, channelId } = threadInfo;
        
        // If we couldn't extract from threadId directly, try the context
        if ((!threadTs || !channelId) && context) {
            threadTs = threadTs || context.threadTs;
            channelId = channelId || context.channelId;
        }
        
        // Log thread info for debugging
        logger.info(`Thread info: threadTs=${threadTs}, channelId=${channelId}`);
        
        // Check if context is already initialized
        const messagesBefore = contextBuilder.getThreadMessages(threadId);
        
        if (messagesBefore && messagesBefore.length > 0) {
            logger.info(`Context already initialized with ${messagesBefore.length} messages`);
            return;
        }
        
        // We need both threadTs and channelId to load history
        if (!threadTs || !channelId) {
            const errorMsg = 'Cannot initialize context: Missing threadTs or channelId';
            logger.error(errorMsg);
            throw new Error(errorMsg);
        }
        
        // Use the internal loadThreadHistory function directly instead of through the tool system
        logger.info(`Initializing context with thread history for ${threadTs}`);
        
        const historyResult = await loadThreadHistory({
            threadTs: threadTs,
            channelId: channelId,
            limit: 10, // Get up to 10 messages 
            includeParent: true,
            reasoning: "Initializing context with thread history"
        }, {
            threadId: threadId,
            threadTs: threadTs,
            channelId: channelId,
            addMessage: (message) => {
                message.threadTs = threadId;
                return contextBuilder.addMessage(message);
            }
        });
        
        logger.info(`Retrieved ${historyResult.messagesRetrieved || 0} messages from thread history for initialization`);
        
        // Verify that initialization was successful
        const messagesAfter = contextBuilder.getThreadMessages(threadId);
        
        if (!messagesAfter || messagesAfter.length === 0) {
            const errorMsg = 'Context initialization failed: No messages after loading history';
            logger.error(errorMsg);
            
            // If history was successfully retrieved but not added to context
            if (historyResult.messagesRetrieved > 0) {
                logger.error(`History API returned ${historyResult.messagesRetrieved} messages but none were added to context`);
                
                // Try a manual rescue - add at least one system message to avoid empty context
                try {
                    contextBuilder.addMessage({
                        source: 'system',
                        text: 'Thread history was retrieved but could not be properly loaded into context. Please continue with limited context.',
                        timestamp: new Date().toISOString(),
                        threadTs: threadId
                    });
                    logger.info('Added emergency system message to context');
                } catch (rescueError) {
                    logger.error(`Failed to add emergency message: ${rescueError.message}`);
                }
            }
            
            throw new Error(errorMsg);
        }
        
        logger.info(`✅ Context initialization successful: ${messagesAfter.length} messages in context`);
        
        // We specifically do NOT record this as a tool execution since we don't want it to appear in the LLM context
    } catch (error) {
        // Log the error but don't suppress it
        logger.error(`❌ Error initializing context: ${error.message}`);
        logError('Error initializing context', error, { threadId });
        
        // Re-throw the error to make sure it's properly handled upstream
        throw error;
    }
}

module.exports = {
    initializeContextIfNeeded
}; 