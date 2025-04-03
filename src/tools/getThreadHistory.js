// Retrieves and formats thread history from Slack
const { getSlackClient } = require('../slackClient.js');
const { logError } = require('../errors.js');
const logger = require('../toolUtils/logger.js');

// Add a simple in-memory cache to prevent redundant calls
const threadHistoryCache = new Map();
const CACHE_TTL_MS = 30000; // 30 seconds cache lifetime

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
    if (args.reasoning) {
      logger.info(`🧠 REASONING: ${args.reasoning}`);
    }
    
    // Handle potential nested parameters structure 
    if (args.parameters && !args.limit) {
      logger.info('Detected nested parameters structure, extracting inner parameters');
      args = { ...args.parameters, reasoning: args.reasoning };
    }
    
    // Extract the top-level reasoning (no need to filter it out)
    const reasoning = args.reasoning;
    
    // Filter out non-standard fields
    const validFields = [
      'limit', 'threadTs', 'channelId', 'includeParent', 'order', 'forceRefresh'
    ];
    
    const filteredArgs = {};
    for (const key of validFields) {
      if (args[key] !== undefined) {
        filteredArgs[key] = args[key];
      }
    }
    
    // Log any filtered fields for debugging (excluding reasoning which we expect at top level)
    const filteredKeys = Object.keys(args)
      .filter(key => !validFields.includes(key) && key !== 'reasoning');
    if (filteredKeys.length > 0) {
      logger.info(`Filtered out non-standard fields: ${filteredKeys.join(', ')}`);
    }
    
    // Use filtered args from now on
    args = filteredArgs;
    
    // Default arguments
    const {
      limit = 20,
      includeParent = true,
      order = 'chronological', // Default order is chronological (oldest first)
      forceRefresh = false // Allow forcing a refresh to bypass cache
    } = args;
    
    // Validate order parameter
    const validOrderValues = ['chronological', 'reverse_chronological'];
    if (!validOrderValues.includes(order)) {
      logger.warn(`Invalid order parameter "${order}". Using default "chronological".`);
    }
    
    // Get thread ID for context
    const threadId = threadContext.threadId;
    
    // Check for repeated calls - get tool execution history if available
    if (threadContext.getToolExecutionHistory) {
      const recentCalls = threadContext.getToolExecutionHistory(threadId, 10)
        .filter(exec => exec.toolName === 'getThreadHistory')
        .filter(exec => !exec.error); // Only count successful calls
      
      // Check if this is being called repeatedly in a short period
      if (recentCalls.length >= 3 && !forceRefresh) {
        // This might be a loop - add special warning
        logger.warn(`⚠️ POTENTIAL LOOP DETECTED: getThreadHistory called ${recentCalls.length} times recently`);
        
        // Return a clear warning in the result
        return {
          warning: `You've called getThreadHistory ${recentCalls.length} times recently. This might indicate a loop. The thread history is already in your context.`,
          previousCalls: recentCalls.length,
          messagesRetrieved: 0,
          loopDetected: true,
          recommendation: "Use the thread history you already have, or use forceRefresh:true if you really need fresh data.",
          isErrorState: false
        };
      }
    }
    
    // Try to get channel ID and thread TS from args first, then fall back to context
    let channelId = args.channelId;
    let threadTs = args.threadTs;
    
    if (!channelId && threadContext) {
      // Try direct property
      if (threadContext.channelId) {
        channelId = threadContext.channelId;
      }
      // Try from metadata
      else if (threadContext.getMetadata) {
        const context = threadContext.getMetadata('context');
        if (context && context.channelId) {
          channelId = context.channelId;
        }
      }
    }
    
    if (!threadTs && threadContext) {
      // Try direct property
      if (threadContext.threadTs) {
        threadTs = threadContext.threadTs;
      }
      // Try from metadata
      else if (threadContext.getMetadata) {
        const context = threadContext.getMetadata('context');
        if (context && context.threadTs) {
          threadTs = context.threadTs;
        }
      }
    }
    
    // Verify we have the necessary context
    if (!channelId) {
      throw new Error('Channel ID not found in thread context');
    }
    
    if (!threadTs) {
      throw new Error('Thread timestamp not found. This tool only works in threads');
    }
    
    // Now threadTs is properly initialized, we can safely use it
    
    // Create a cache key based on thread ID, limit, and order
    const cacheKey = `${threadTs}_${limit}_${order}`;
    
    // Check if we have a recent cached result and forceRefresh is not true
    if (!forceRefresh && threadHistoryCache.has(cacheKey)) {
      const cachedResult = threadHistoryCache.get(cacheKey);
      
      // Check if the cache is still valid (within TTL)
      if (Date.now() - cachedResult.timestamp < CACHE_TTL_MS) {
        logger.info(`Using cached thread history for thread ${threadTs} (${limit} messages, ${order})`);
        
        // Clone the result to prevent mutation
        const result = JSON.parse(JSON.stringify(cachedResult.result));
        
        // Add a note that this came from cache
        result.fromCache = true;
        result.cachedAt = new Date(cachedResult.timestamp).toISOString();
        
        return result;
      } else {
        // Cache expired, remove it
        threadHistoryCache.delete(cacheKey);
        logger.info(`Thread history cache expired for ${threadTs}, fetching fresh data`);
      }
    } else if (forceRefresh) {
      logger.info(`Force refreshing thread history for ${threadTs}`);
    }
    
    // Get Slack client
    const slackClient = getSlackClient();
    
    // Get thread statistics
    let totalMessagesInThread = 0;
    
    // First get thread information to know total messages
    // We're intentionally using a small limit first to just get the count
    const threadInfo = await slackClient.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 5
    });
    
    // Get thread statistics
    totalMessagesInThread = threadInfo.messages?.[0]?.reply_count || 0;
    
    // Now fetch the actual messages we want
    const result = await slackClient.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: limit,
      inclusive: true // Always include the parent message
    });
    
    // Format the messages
    const formattedMessages = [];
    const botUserId = await getBotUserId(slackClient);
    
    // Initialize message counters outside the conditional block
    let messagesWithContent = 0;
    let messagesWithoutContent = 0;
    
    // Process the messages
    if (result.messages && result.messages.length > 0) {
      // Add detailed logging of retrieved messages
      logger.info(`Retrieved ${result.messages.length} raw messages from thread`);
      
      // Replace verbose logging with a compact summary
      // Process the messages first to get counts
      result.messages.forEach((message) => {
        if (message.text || message.attachments?.length) {
          messagesWithContent++;
        } else {
          messagesWithoutContent++;
        }
      });
      
      // Log a compact summary instead of each message
      logger.info(`Thread stats: ${messagesWithContent} with content, ${messagesWithoutContent} without content, ${result.messages.length} total`);
      
      // Add compact preview of first few messages (only in verbose mode)
      if (process.env.VERBOSE_LOGGING === 'true') {
        const previewCount = Math.min(3, result.messages.length);
        const previews = result.messages.slice(0, previewCount).map((msg, idx) => {
          const preview = msg.text ? 
            (msg.text.length > 40 ? msg.text.substring(0, 40) + '...' : msg.text) : 
            '[No text]';
          return `[${idx}] ${preview}${msg.attachments?.length ? ` (+${msg.attachments.length} attachments)` : ''}`;
        });
        
        logger.info(`Message previews: ${previews.join(' | ')}`);
      }
      
      for (const message of result.messages) {
        // Skip messages without text or attachments
        if (!message.text && !message.attachments?.length) continue;
        
        // Determine if this is a bot message
        const isBot = message.bot_id || message.user === botUserId;
        const isParent = message.ts === threadTs;
        
        // Format text content
        let formattedText = message.text || '';
        
        // Filter out dev prefix '!@#' from the text
        if (formattedText.startsWith('!@#')) {
          formattedText = formattedText.substring(3).trim();
        }
        
        // Always process attachments
        if (message.attachments?.length) {
          formattedText += formatAttachments(message.attachments);
        }
        
        // Skip empty messages after processing
        if (!formattedText.trim()) continue;
        
        // Create the formatted message
        formattedMessages.push({
          isUser: !isBot,
          userId: message.user,
          text: formattedText,
          timestamp: message.ts,
          isParent,
          threadTs: threadTs // Add explicit thread timestamp for each message
        });
      }
    }
    
    // Sort messages by timestamp according to specified order
    if (order === 'reverse_chronological') {
      // Newest first
      logger.info('Sorting messages in reverse chronological order (newest first)');
      formattedMessages.sort((a, b) => parseFloat(b.timestamp) - parseFloat(a.timestamp));
    } else {
      // Default: oldest first
      logger.info('Sorting messages in chronological order (oldest first)');
      formattedMessages.sort((a, b) => parseFloat(a.timestamp) - parseFloat(b.timestamp));
    }
    
    // Add message indices - parent is always [0] regardless of sort order
    // For other messages, indexes depend on the order and total thread size
    const parentIndex = formattedMessages.findIndex(msg => msg.isParent);
    
    // Get the total size of the thread to calculate proper indices
    const totalMessages = totalMessagesInThread + 1; // Including parent message
    
    // Start assigning indices
    formattedMessages.forEach((msg, idx) => {
      if (msg.isParent) {
        // Parent message is always [0]
        msg.messageIndex = 0;
      } else {
        // For non-parent messages, calculate index based on order
        if (order === 'reverse_chronological') {
          // For reverse chronological, start from end of thread
          // If we have a thread of 20 messages and we got the latest 10,
          // indices should be [10], [11], ..., [19]
          const offset = Math.max(0, totalMessages - formattedMessages.length);
          msg.messageIndex = offset + (formattedMessages.length - 1 - idx);
        } else {
          // For chronological, if we pull first messages, indices should be [1], [2], ..., [10]
          // If parent is included, one of these will be replaced with [0]
          msg.messageIndex = idx;
          
          // Adjust if parent is in the list (we already gave it index 0)
          if (parentIndex !== -1 && idx > parentIndex) {
            msg.messageIndex = idx - 1;
          }
        }
      }
      
      // Convert to string format with brackets: [0], [1], etc.
      msg.messageIndexStr = `[${msg.messageIndex}]`;
    });
    
    // Log formatted messages with a compact summary instead of individual entries
    logger.info(`Processed ${formattedMessages.length} formatted messages in ${order} order (${formattedMessages.filter(m => m.isUser).length} user, ${formattedMessages.filter(m => !m.isUser).length} bot, ${formattedMessages.filter(m => m.isParent).length} parent)`);
    
    // Only log detailed message info in verbose mode
    if (process.env.VERBOSE_LOGGING === 'true') {
      formattedMessages.forEach((msg, idx) => {
        const preview = msg.text ? (msg.text.length > 40 ? msg.text.substring(0, 40) + '...' : msg.text) : '[No text]';
        logger.info(`${msg.messageIndexStr} ${msg.isUser ? 'USER' : 'BOT'} ${preview}${msg.isParent ? ' (PARENT)' : ''}`);
      });
    }
    
    // Add messages to the context builder if available
    if (threadContext && threadContext.addMessage && formattedMessages.length > 0) {
      // Get the context builder instance to check for existing messages
      const contextBuilder = require('../contextBuilder').getContextBuilder();
      const existingThreadMessages = contextBuilder.getThreadMessages(threadId);
      
      // Track existing messages by their timestamp to avoid duplicates
      const existingMessageTimestamps = new Set();
      existingThreadMessages.forEach(msg => {
        if (msg.timestamp) {
          // Convert ISO timestamp to Unix timestamp (seconds) for comparison
          const unixTimestamp = new Date(msg.timestamp).getTime() / 1000;
          existingMessageTimestamps.add(unixTimestamp.toString());
        }
      });
      
      // Count how many messages we're adding to context
      let messagesAddedToContext = 0;
      let skippedDuplicates = 0;
      let failedAdditions = 0;
      
      // Add only non-duplicate formatted messages to the context
      for (const msg of formattedMessages) {
        // Skip if this message timestamp already exists in the context
        if (existingMessageTimestamps.has(msg.timestamp.toString())) {
          skippedDuplicates++;
          continue;
        }
        
        // Create message object with all required fields
        const messageObj = {
          source: msg.isUser ? 'user' : 'assistant',
          id: `${msg.isUser ? 'user' : 'bot'}_${msg.timestamp}`,
          timestamp: new Date(msg.timestamp * 1000).toISOString(),
          threadTs: msg.threadTs || threadId, // Ensure threadTs is set correctly
          text: msg.text,
          sourceId: msg.userId,
          type: 'history',
          metadata: {
            isParent: msg.isParent,
            fromHistory: true,
            threadTs: msg.threadTs || threadId, // Additional thread info in metadata
            messageIndex: msg.messageIndex, // Add message index to metadata
            messageIndexStr: msg.messageIndexStr // Add formatted string version
          }
        };
        
        // Try to add to context and track success
        try {
          const result = threadContext.addMessage(messageObj);
          if (result) {
            messagesAddedToContext++;
          } else {
            failedAdditions++;
          }
        } catch (err) {
          failedAdditions++;
          logger.error(`Error adding message to context: ${err.message}`);
        }
      }
      
      // Single log line for context addition summary
      logger.info(`Context rebuilt: Added ${messagesAddedToContext}/${formattedMessages.length} messages to context builder (${skippedDuplicates} duplicates skipped, ${failedAdditions} failed)`);
    } else {
      // Simplified error reporting
      const reason = !threadContext ? 'No thread context' : 
                    !threadContext.addMessage ? 'No addMessage method available' : 
                    formattedMessages.length === 0 ? 'No messages to add' : 'Unknown reason';
      logger.warn(`Context not rebuilt: ${reason}`);
      
      // Include formatted messages in return value even if we couldn't add them to context
      // This way the LLM can still use them to display thread history
      // This respects the LLM-first principle by giving the LLM the data to make decisions
    }
    
    // Return a summary of what we did along with thread statistics
    const summary = {
      messagesRetrieved: formattedMessages.length,
      threadTs,
      channelId,
      threadStats: {
        totalMessagesInThread,
        parentMessageRetrieved: formattedMessages.some(msg => msg.isParent),
        remainingMessages: Math.max(0, totalMessagesInThread - formattedMessages.length + 1), // +1 accounts for parent message
        messagesWithContent: messagesWithContent || 0,
        messagesWithoutContent: messagesWithoutContent || 0
      },
      indexInfo: {
        hasParent: formattedMessages.some(msg => msg.isParent),
        indices: formattedMessages.map(msg => msg.messageIndex),
        order: order,
        messageCount: totalMessages,
        retrievedMessages: formattedMessages.length,
        missingMessages: Math.max(0, totalMessages - formattedMessages.length),
        indexRange: formattedMessages.length > 0 ? 
          `${formattedMessages[0].messageIndexStr}-${formattedMessages[formattedMessages.length-1].messageIndexStr}` : 
          "none"
      },
      formattedMessagesPreview: formattedMessages.slice(0, 3).map(msg => ({
        isUser: msg.isUser,
        textPreview: msg.text ? (msg.text.length > 50 ? msg.text.substring(0, 50) + '...' : msg.text) : '[No text]',
        isParent: msg.isParent,
        messageIndex: msg.messageIndex,
        messageIndexStr: msg.messageIndexStr
      })),
      contextRebuilt: formattedMessages.length > 0,
      // Add the actual messages for the LLM to use directly
      messages: formattedMessages.map(msg => ({
        isUser: msg.isUser,
        text: msg.text,
        messageIndex: msg.messageIndex,
        messageIndexStr: msg.messageIndexStr,
        isParent: msg.isParent,
        timestamp: msg.timestamp,
        displayLabel: msg.isUser ? '[USER]' : '[BOT]',
        // Add a timestamped full format for better display
        formattedDisplay: `${msg.isUser ? '[USER]' : '[BOT]'} ${msg.text}`
      })),
      // Add a ready-to-use formatted history text to make displaying thread history easier
      formattedHistoryText: formattedMessages.length > 0 ? 
        formattedMessages.map(msg => 
          `${msg.isUser ? '[USER]' : '[BOT]'} ${msg.text}`
        ).join('\n\n') : 
        "No messages found in thread history."
    };
    
    // Cache the result
    threadHistoryCache.set(cacheKey, {
      timestamp: Date.now(),
      result: summary
    });
    
    // Record the tool execution in the context builder
    if (threadContext) {
      const contextBuilder = require('../contextBuilder').getContextBuilder();
      contextBuilder.recordToolExecution(
        threadId,
        'getThreadHistory',
        args,
        summary
      );
    }
    
    return summary;
  } catch (error) {
    logError('Error retrieving thread history', error);
    throw error;
  }
}

/**
 * Gets the bot's own user ID
 * @param {Object} slackClient - Slack client
 * @returns {Promise<string>} - Bot user ID
 */
async function getBotUserId(slackClient) {
  try {
    const authInfo = await slackClient.auth.test();
    return authInfo.user_id;
  } catch (error) {
    logError('Error getting bot user ID', error);
    return null;
  }
}

/**
 * Formats attachments into a text description
 * @param {Array} attachments - Slack message attachments
 * @returns {string} - Formatted attachment descriptions
 */
function formatAttachments(attachments) {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
    return '';
  }
  
  let result = '';
  
  for (const attachment of attachments) {
    // Check if attachment contains blocks (this is common for messages with interactive elements)
    if (attachment.blocks && attachment.blocks.length > 0) {
      result += '\n' + formatBlocks(attachment.blocks);
    }
    // Handle images
    else if (attachment.image_url) {
      result += `\n[Image: ${attachment.image_url}]`;
    }
    // Handle files
    else if (attachment.files) {
      for (const file of attachment.files) {
        result += `\n[File: ${file.name || 'unnamed'} - ${file.url_private || 'no url'}]`;
      }
    }
    // Handle links with previews
    else if (attachment.title_link) {
      result += `\n[Link: ${attachment.title || attachment.title_link} - ${attachment.title_link}]`;
    }
    // Handle other attachments with text
    else if (attachment.text) {
      result += `\n${attachment.text}`;
    }
    // Other attachments - use fallback text if available
    else if (attachment.fallback) {
      // Skip generic "[no preview available]" fallback
      if (attachment.fallback !== '[no preview available]') {
        result += `\n${attachment.fallback}`;
      }
    }
    // Add color information as context if available
    if (attachment.color) {
      // Convert hex color to descriptive name if possible
      const colorName = getColorName(attachment.color);
      if (colorName) {
        result += ` (${colorName} theme)`;
      }
    }
  }
  
  return result;
}

/**
 * Recursively formats blocks into text
 * @param {Array} blocks - Slack blocks to format
 * @returns {string} - Formatted text from blocks
 */
function formatBlocks(blocks) {
  if (!blocks || !Array.isArray(blocks)) {
    return '';
  }
  
  let result = '';
  
  for (const block of blocks) {
    // Handle different block types
    switch (block.type) {
      case 'header':
        if (block.text && block.text.text) {
          result += `\n# ${block.text.text}`;
        }
        break;
        
      case 'section':
        if (block.text && block.text.text) {
          result += `\n${block.text.text}`;
        }
        // Handle fields in section
        if (block.fields && block.fields.length > 0) {
          block.fields.forEach(field => {
            if (field.text) {
              result += `\n${field.text}`;
            }
          });
        }
        break;
        
      case 'actions':
        // Extract button information
        if (block.elements && block.elements.length > 0) {
          const buttons = block.elements
            .filter(el => el.type === 'button')
            .map(btn => {
              const buttonText = btn.text?.text || 'Button';
              const buttonValue = btn.value || '';
              return `[${buttonText}${buttonValue ? ': ' + buttonValue : ''}]`;
            })
            .join(', ');
          
          if (buttons) {
            result += `\nButtons: ${buttons}`;
          }
        }
        break;
        
      case 'context':
        if (block.elements && block.elements.length > 0) {
          block.elements.forEach(element => {
            if (element.text) {
              result += `\n_${element.text}_`;
            }
          });
        }
        break;
        
      case 'divider':
        result += '\n---';
        break;
        
      case 'image':
        result += `\n[Image${block.title ? ': ' + block.title.text : ''}${block.alt_text ? ' (' + block.alt_text + ')' : ''}]`;
        break;
        
      case 'rich_text':
        // Process rich text elements
        if (block.elements) {
          for (const element of block.elements) {
            if (element.type === 'rich_text_section' && element.elements) {
              for (const subElement of element.elements) {
                if (subElement.type === 'text') {
                  result += subElement.text;
                }
              }
            }
          }
        }
        break;
    }
  }
  
  return result;
}

/**
 * Convert hex color to a descriptive name
 * @param {string} color - Color in hex or Slack color name
 * @returns {string|null} - Descriptive color name or null if not recognized
 */
function getColorName(color) {
  if (!color) return null;
  
  // Remove # from hex and standardize
  const formattedColor = color.startsWith('#') ? color.toLowerCase() : color;
  
  // Map of common Slack colors
  const colorMap = {
    'good': 'green',
    'warning': 'yellow',
    'danger': 'red',
    '#36c5f0': 'blue',
    '#2eb67d': 'green',
    '#e01e5a': 'red',
    '#ecb22e': 'yellow'
  };
  
  return colorMap[formattedColor] || null;
}

/**
 * Clears the thread history cache for a specific thread or all threads
 * @param {string} [threadId] - Optional thread ID to clear. If not provided, clears all cache.
 * @returns {number} - Number of cache entries cleared
 */
function clearThreadCache(threadId) {
  if (!threadId) {
    // Clear all cache
    const count = threadHistoryCache.size;
    threadHistoryCache.clear();
    logger.info(`Cleared entire thread history cache (${count} entries)`);
    return count;
  }
  
  // Clear only cache entries for this thread
  let count = 0;
  
  // Find all cache keys for this thread
  const keysToDelete = [];
  for (const key of threadHistoryCache.keys()) {
    if (key.startsWith(threadId + '_')) {
      keysToDelete.push(key);
    }
  }
  
  // Delete the entries
  for (const key of keysToDelete) {
    threadHistoryCache.delete(key);
    count++;
  }
  
  logger.info(`Cleared ${count} thread history cache entries for thread ${threadId}`);
  return count;
}

module.exports = {
  getThreadHistory,
  clearThreadCache
}; 