// Retrieves and formats thread history from Slack
const { getSlackClient } = require('../slackClient.js');
const { logError } = require('../errors.js');
const logger = require('../toolUtils/logger.js');
const { formatTimestamp, formatRelativeTime } = require('../toolUtils/dateUtils.js');
const { getThreadContextBuilder } = require('../threadContextBuilder.js');

// Add a simple in-memory cache to prevent redundant calls
const threadHistoryCache = new Map();
const CACHE_TTL_MS = 30000; // 30 seconds cache lifetime

// Add a tool call counter at the top of the file, after requires
const callCounter = new Map(); // threadId -> count

/**
 * Tool to retrieve the history of a thread for context rebuilding
 * @param {Object} args - Arguments
 * @param {number} [args.limit=20] - Maximum number of messages to retrieve
 * @param {Object} threadContext - Thread context object
 * @returns {Promise<Object>} - Formatted thread history and thread stats
 */
async function getThreadHistory(args = {}, threadContext) {
  try {
    // Log reasoning if available
    if (args && args.reasoning) {
      logger.info(`🧠 REASONING: ${args.reasoning}`);
    }
    
    // Handle potential nested parameters structure 
    if (args && args.parameters && !args.limit) {
      logger.info('Detected nested parameters structure, extracting inner parameters');
      args = { ...(args.parameters || {}), reasoning: args.reasoning };
    }
    
    // Ensure args is always an object
    args = args || {};
    
    // Extract core arguments with defaults
    const limit = args.limit || 20;
    const ascending = args.ascending !== false; // Default to true
    const forceRefresh = args.forceRefresh === true;
    
    // Ensure threadContext is valid
    if (!threadContext) {
      throw new Error('Thread context is required for getThreadHistory');
    }
    
    // Get thread ID for context
    const threadId = threadContext.threadId;
    const channelId = threadContext.channelId;
    const threadTs = threadContext.threadTs;
    
    if (!threadId) {
      throw new Error('Thread ID is missing in thread context');
    }
    
    if (!channelId) {
      throw new Error('Channel ID is missing in thread context');
    }
    
    // Track call count for this thread
    if (!callCounter.has(threadId)) {
      callCounter.set(threadId, 1);
    } else {
      const currentCount = callCounter.get(threadId);
      callCounter.set(threadId, currentCount + 1);
      
          // Only block if there are excessive calls in a very short time period
    // Allow legitimate use cases like "show me my first message"
    if (currentCount >= 5 && !forceRefresh) {
      logger.warn(`⚠️ EXCESSIVE CALLS: getThreadHistory called ${currentCount} times for thread ${threadId}`);
      
      // Don't clear the counter - let it continue tracking
      // But return the history anyway with a warning
      logger.info(`Proceeding with getThreadHistory despite ${currentCount} calls - user may have legitimate need`);
    }
    }
    
    // Get the ThreadContextBuilder
    const threadContextBuilder = getThreadContextBuilder();
    
    // Clear cache if force refresh requested
    if (forceRefresh) {
      threadContextBuilder.clearCache(threadTs, channelId);
      logger.info(`Forced refresh of thread cache for ${threadTs}`);
    }
    
    // Get thread information directly from ThreadContextBuilder
    const threadInfo = await threadContextBuilder._getThreadInfo(threadTs, channelId);
    
    // Format messages for presentation to the LLM
    const formattedMessages = threadInfo.messages.map((msg, index) => {
      // Determine message type (user, bot, system)
      const isUser = !(msg.bot_id || msg.subtype === 'bot_message' || (msg.user === process.env.SLACK_BOT_USER_ID));
      const isSystem = msg.subtype && ['channel_join', 'channel_leave', 'channel_purpose', 'channel_topic'].includes(msg.subtype);
      
      // Format user info
      const userIdentifier = isUser ? `<@${msg.user || 'unknown'}>` : 'Aya';
      
      // Convert timestamp to readable format
      const timestamp = msg.ts ? formatTimestamp(parseFloat(msg.ts)) : 'Unknown time';
      
      // Prefix for each message
      const prefix = `[${index}] ${isUser ? '👤' : isSystem ? '🔄' : '🤖'} `;
      
      // Handle attachments/blocks - simplify for presentation
      let attachmentText = '';
      if (msg.attachments && msg.attachments.length > 0) {
        attachmentText = msg.attachments.map(att => 
          `\n    📎 ${att.title || 'Attachment'}: ${att.text || att.fallback || 'No description'}`
        ).join('');
      }
      
      // Format final message text
      return {
        index,
        text: `${prefix}${userIdentifier} (${timestamp}):\n${msg.text || ''}${attachmentText}`,
        isUser,
        isSystem,
        user: msg.user,
        timestamp: msg.ts,
        hasAttachments: !!msg.attachments?.length,
        hasBlocks: !!msg.blocks?.length
      };
    });
    
    // Apply limit and ordering
    const limitedMessages = ascending 
      ? formattedMessages.slice(0, limit) 
      : formattedMessages.slice(-limit).reverse();
    
    // Generate formatted history text - use a readable format for the LLM
    const historyHeader = `Thread History in ${threadInfo.isThread ? 'Thread' : 'Direct Message'} (${formattedMessages.length} messages total):\n`;
    const formattedHistoryText = historyHeader + limitedMessages.map(m => m.text).join('\n\n');
    
    // Create indexing info
    const indexInfo = {
      indexRange: ascending 
        ? `0-${limitedMessages.length - 1}` 
        : `${formattedMessages.length - limitedMessages.length}-${formattedMessages.length - 1}`,
      messageCount: formattedMessages.length,
      missingMessages: Math.max(0, formattedMessages.length - limitedMessages.length)
    };
    
    // Create thread stats
    const threadStats = {
      totalMessagesInThread: formattedMessages.length,
      remainingMessages: Math.max(0, formattedMessages.length - limitedMessages.length),
      parentMessageRetrieved: threadInfo.parentMessage !== null
    };
    
    // Prepare result
    const result = {
      messagesRetrieved: limitedMessages.length,
      messages: limitedMessages,
      formattedHistoryText,
      threadStats,
      indexInfo,
      fromCache: !forceRefresh,
      cachedAt: forceRefresh ? null : new Date().toISOString()
    };
    
    // Cache the result
    const cacheKey = `${threadTs}_${limit}_${ascending}`;
    threadHistoryCache.set(cacheKey, {
      result: JSON.parse(JSON.stringify(result)),
      timestamp: Date.now()
    });
    
    logger.info(`Retrieved ${limitedMessages.length} messages from thread history (${ascending ? 'ascending' : 'descending'} order)`);
    return result;
  } catch (error) {
    logger.error(`Error in getThreadHistory: ${error.message}`);
    
    // Try legacy method as fallback
    try {
      logger.info("Attempting to use legacy thread history loading as fallback");
      return await loadThreadHistory(args, threadContext);
    } catch (fallbackError) {
      logger.error(`Legacy fallback also failed: ${fallbackError.message}`);
      throw error;
    }
  }
}

// Keep the legacy implementation as a fallback
async function loadThreadHistory(args = {}, threadContext) {
  // Original implementation - keep for backwards compatibility
  // ... (existing implementation)
  
  logger.info("Using legacy thread history loading");
  
  // Get Slack client
  const slackClient = getSlackClient();
  
  // Extract necessary context
  const channelId = threadContext.channelId;
  const threadTs = threadContext.threadTs;
  
  if (!channelId || !threadTs) {
    throw new Error("Missing required channel ID or thread timestamp");
  }
  
  // Get thread messages
  const result = await slackClient.conversations.replies({
    channel: channelId,
    ts: threadTs,
    limit: args.limit || 20
  });
  
  if (!result.ok) {
    throw new Error(`Slack API error: ${result.error}`);
  }
  
  // Basic formatting
  const messages = result.messages || [];
  const formattedMessages = messages.map((msg, idx) => {
    return {
      index: idx,
      text: msg.text || '',
      user: msg.user,
      timestamp: msg.ts,
      isUser: !msg.bot_id
    };
  });
  
  return {
    messagesRetrieved: formattedMessages.length,
    messages: formattedMessages,
    threadStats: {
      totalMessagesInThread: messages.length,
      remainingMessages: 0
    },
    isLegacyFormat: true
  };
}

// Function to clear thread cache
function clearThreadCache(threadId) {
  // Find and remove all cache entries for this thread
  const keysToRemove = [];
  
  for (const key of threadHistoryCache.keys()) {
    if (key.startsWith(threadId)) {
      keysToRemove.push(key);
    }
  }
  
  keysToRemove.forEach(key => threadHistoryCache.delete(key));
  
  // Also clear call counter
  callCounter.delete(threadId);
  
  // Also clear ThreadContextBuilder cache
  try {
    const threadContextBuilder = getThreadContextBuilder();
    const channelId = threadId.split('_')[0] || threadId;
    threadContextBuilder.clearCache(threadId, channelId);
  } catch (error) {
    logger.warn(`Error clearing ThreadContextBuilder cache: ${error.message}`);
  }
  
  logger.info(`Cleared thread history cache for ${threadId}`);
  return true;
}

// Export the main function
module.exports = getThreadHistory;

// Also export the internal function and cache clearing function
module.exports.loadThreadHistory = loadThreadHistory;
module.exports.clearThreadCache = clearThreadCache;
module.exports.callCounter = callCounter; 