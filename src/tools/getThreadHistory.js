// Retrieves and formats thread history from Slack
const { getSlackClient } = require('../slackClient.js');
const { logError } = require('../errors.js');

/**
 * Tool to retrieve the history of a thread for context rebuilding
 * @param {Object} args - Arguments
 * @param {number} [args.limit=20] - Maximum number of messages to retrieve
 * @param {Object} threadState - Current thread state
 * @returns {Promise<Object>} - Formatted thread history and thread stats
 */
async function getThreadHistory(args = {}, threadState) {
  try {
    // Default arguments
    const {
      limit = 20
    } = args;
    
    // Get required context info
    const { channelId, threadTs, threadStats } = threadState.context;
    
    // Verify we have the necessary context
    if (!channelId) {
      throw new Error('Channel ID not found in thread context');
    }
    
    if (!threadTs) {
      throw new Error('Thread timestamp not found. This tool only works in threads');
    }
    
    // Get Slack client
    const slackClient = getSlackClient();
    
    // Use existing thread statistics if available and recent (less than 1 minute old)
    let totalMessagesInThread = 0;
    const threadStatsAreRecent = threadStats && 
      new Date().getTime() - new Date(threadStats.lastChecked).getTime() < 60000;
    
    if (threadStatsAreRecent) {
      totalMessagesInThread = threadStats.totalMessagesInThread;
      console.log(`- Using existing thread stats: ${totalMessagesInThread} messages in thread`);
    } else {
      // First get thread information to know total messages
      // We're intentionally using a small limit first to just get the count
      const threadInfo = await slackClient.conversations.replies({
        channel: channelId,
        ts: threadTs,
        limit: 5
      });
      
      // Get thread statistics
      totalMessagesInThread = threadInfo.messages?.[0]?.reply_count || 0;
    }
    
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
    
    // Process the messages
    if (result.messages && result.messages.length > 0) {
      for (const message of result.messages) {
        // Skip messages without text or attachments
        if (!message.text && !message.attachments?.length) continue;
        
        // Determine if this is a bot message
        const isBot = message.bot_id || message.user === botUserId;
        const isParent = message.ts === threadTs;
        
        // Format text content
        let formattedText = message.text || '';
        
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
          isParent
        });
      }
    }
    
    // Add the formatted messages to the thread state
    if (formattedMessages.length > 0) {
      // Sort messages by timestamp to ensure chronological order
      formattedMessages.sort((a, b) => parseFloat(a.timestamp) - parseFloat(b.timestamp));
      
      // Clear existing messages if we're rebuilding context
      threadState.messages = [];
      
      // Add all formatted messages to the thread state
      for (const msg of formattedMessages) {
        threadState.messages.push(msg);
      }
      
      // Set mayNeedHistory to false since we've now loaded the history
      threadState.context.mayNeedHistory = false;
    }
    
    // Return a summary of what we did along with thread statistics
    return {
      messagesRetrieved: formattedMessages.length,
      threadTs,
      channelId,
      threadStats: {
        totalMessagesInThread,
        parentMessageRetrieved: formattedMessages.some(msg => msg.isParent),
        remainingMessages: Math.max(0, totalMessagesInThread - formattedMessages.length + 1) // +1 accounts for parent message
      },
      contextRebuilt: formattedMessages.length > 0
    };
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
  let result = '';
  
  for (const attachment of attachments) {
    // Handle images
    if (attachment.image_url) {
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
    // Other attachments
    else if (attachment.fallback) {
      result += `\n${attachment.fallback}`;
    }
  }
  
  return result;
}

module.exports = {
  getThreadHistory
}; 