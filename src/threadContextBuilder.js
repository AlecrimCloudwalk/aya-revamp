/**
 * ThreadContextBuilder - A dedicated, simplified context builder for LLM conversations
 * Follows the exact format specified in docs/llm_context_format.md
 */

const { WebClient } = require('@slack/web-api');
const logger = require('./toolUtils/logger.js');
const config = require('./config.js');
const slack = new WebClient(config.SLACK_BOT_TOKEN);
const ayaPrompts = require('./prompts/aya.js');

class ThreadContextBuilder {
  constructor() {
    this.cache = new Map(); // Cache for thread history
    this.cacheExpiration = 30 * 1000; // 30 seconds cache expiration
  }

  /**
   * Build the complete context array for the LLM following the specified format
   * @param {string} threadTs - Thread timestamp
   * @param {string} channelId - Channel ID
   * @param {Object} options - Options for context building
   * @returns {Promise<Array>} - Array of context objects
   */
  async buildContext(threadTs, channelId, options = {}) {
    logger.info(`Building thread context for ${threadTs} in channel ${channelId}`);
    
    // Get thread info and messages
    const threadInfo = await this._getThreadInfo(threadTs, channelId);
    
    // Extract the most recent user ID to use in system prompt
    let currentUserId = null;
    for (let i = threadInfo.messages.length - 1; i >= 0; i--) {
      const message = threadInfo.messages[i];
      if (message.user && !message.bot_id && message.subtype !== 'bot_message' && message.user !== config.SLACK_BOT_USER_ID) {
        currentUserId = message.user;
        break;
      }
    }
    
    // Start with the system message, including user ID for USER_ID replacement
    const context = [
      this._createSystemMessage(ayaPrompts.getCompleteSystemPrompt(currentUserId))
    ];
    
    // Add thread info context message
    context.push(this._createThreadInfoMessage(threadInfo));
    
    // Add messages from the thread in chronological order
    let index = context.length;
    let currentTurn = 0;
    let lastRole = null;
    
    for (const message of threadInfo.messages) {
      // Determine the role
      const role = this._determineMessageRole(message);
      
      // Increment turn counter when role changes from assistant to user
      if (lastRole === 'assistant' && role === 'user') {
        currentTurn++;
      }
      
      // Format the message content based on role
      const content = this._formatMessageContent(message, role);
      
      // Add the message to context
      context.push({
        index,
        turn: currentTurn,
        timestamp: message.ts ? new Date(message.ts * 1000).toISOString() : new Date().toISOString(),
        role,
        content
      });
      
      index++;
      lastRole = role;
    }
    
    // Record the presence of tool executions for debugging
    const hasToolExecutions = context.some(msg => 
      msg.role === 'assistant' && 
      typeof msg.content === 'object' && 
      msg.content.toolCall
    );
    
    logger.info(`Built context with ${context.length} items (${hasToolExecutions ? 'includes' : 'no'} tool executions)`);
    
    return context;
  }
  
  /**
   * Create a system message
   * @param {string} text - System message text
   * @returns {Object} - System message object
   */
  _createSystemMessage(text) {
    return {
      index: 0,
      turn: 0,
      timestamp: new Date().toISOString(),
      role: 'system',
      content: text
    };
  }
  
  /**
   * Create a thread info message
   * @param {Object} threadInfo - Thread information
   * @returns {Object} - Thread info message object
   */
  _createThreadInfoMessage(threadInfo) {
    let infoText = "";
    
    // Is this a thread or DM?
    if (threadInfo.isThread) {
      infoText += `You are in a thread conversation with ${threadInfo.userCount} participants. `;
      infoText += `This thread has ${threadInfo.messages.length} messages. `;
      if (threadInfo.parentMessage) {
        infoText += `The thread was started with: "${this._truncateText(threadInfo.parentMessage.text, 100)}" `;
      }
    } else {
      infoText += `You are in a direct message conversation with the user. `;
      infoText += `This conversation has ${threadInfo.messages.length} messages. `;
    }
    
    infoText += `The current date and time is ${new Date().toLocaleString('en-US', { 
      timeZone: 'America/Sao_Paulo', 
      dateStyle: 'full', 
      timeStyle: 'long' 
    })}. `;
    
    // Channel type info
    infoText += `This conversation is taking place in a ${threadInfo.channelType} channel.`;
    
    return {
      index: 1,
      turn: 0,
      timestamp: new Date().toISOString(),
      role: 'system',
      content: infoText
    };
  }
  
  /**
   * Determine the role of a message
   * @param {Object} message - Slack message object
   * @returns {string} - Role (system, user, or assistant)
   */
  _determineMessageRole(message) {
    // System messages (e.g., channel join, leave)
    if (message.subtype && ['channel_join', 'channel_leave', 'channel_purpose', 'channel_topic'].includes(message.subtype)) {
      return 'system';
    }
    
    // Bot messages
    if (message.bot_id || message.subtype === 'bot_message' || (message.user === config.SLACK_BOT_USER_ID)) {
      return 'assistant';
    }
    
    // Default to user
    return 'user';
  }
  
  /**
   * Format the content of a message based on its role
   * @param {Object} message - Slack message object
   * @param {string} role - Message role
   * @returns {string|Object} - Formatted content
   */
  _formatMessageContent(message, role) {
    if (role === 'system') {
      return message.text || 'System notification';
    } else if (role === 'user') {
      return {
        userid: `<@${message.user}>`,
        text: message.text || ''
      };
    } else if (role === 'assistant') {
      // Check if we can identify a tool call
      const toolCall = this._extractToolCall(message);
      
      if (toolCall) {
        return {
          toolCall: toolCall.name,
          ...toolCall.params,
          text: message.text || '',
          reasoning: toolCall.reasoning || 'No reasoning provided'
        };
      }
      
      return {
        text: message.text || '',
        reasoning: 'Message posted to user'
      };
    }
    
    // Default fallback
    return message.text || '';
  }
  
  /**
   * Extract tool call information from message metadata or text
   * @param {Object} message - Slack message object
   * @returns {Object|null} - Tool call info or null
   */
  _extractToolCall(message) {
    // Try to extract from metadata
    if (message.metadata && message.metadata.event_type === 'tool_call') {
      return {
        name: message.metadata.tool_name || 'unknown',
        params: message.metadata.params || {},
        reasoning: message.metadata.reasoning
      };
    }
    
    // Check for common tool calls in the text
    const toolPatterns = [
      { regex: /Getting thread history/i, name: 'getThreadHistory' },
      { regex: /Searching for information/i, name: 'search' },
      { regex: /Completing your request/i, name: 'finishRequest' }
    ];
    
    for (const pattern of toolPatterns) {
      if (pattern.regex.test(message.text)) {
        return {
          name: pattern.name,
          params: {},
          reasoning: 'Inferred from message text'
        };
      }
    }
    
    return null;
  }
  
  /**
   * Get thread information and messages
   * @param {string} threadTs - Thread timestamp
   * @param {string} channelId - Channel ID
   * @returns {Promise<Object>} - Thread info
   */
  async _getThreadInfo(threadTs, channelId) {
    // Check cache first
    const cacheKey = `${channelId}:${threadTs}`;
    const cachedInfo = this._getFromCache(cacheKey);
    if (cachedInfo) {
      logger.info(`Using cached thread info for ${threadTs}`);
      return cachedInfo;
    }
    
    logger.info(`Fetching thread info for ${threadTs} from Slack API`);
    
    try {
      // Determine if this is a thread or DM
      const isThread = threadTs !== channelId;
      
      // Get channel info
      const channelInfo = await slack.conversations.info({ channel: channelId });
      const channelType = channelInfo.channel?.is_im ? 'direct message' : 
                         channelInfo.channel?.is_private ? 'private' : 'public';
      
      // Get messages
      let messages = [];
      let userIds = new Set();
      let parentMessage = null;
      
      if (isThread) {
        // Get thread messages
        const result = await slack.conversations.replies({
          channel: channelId,
          ts: threadTs,
          limit: 100
        });
        
        messages = result.messages || [];
        
        // The first message is the parent
        if (messages.length > 0) {
          parentMessage = { ...messages[0] };
        }
      } else {
        // Get DM history
        const result = await slack.conversations.history({
          channel: channelId,
          limit: 100
        });
        
        messages = result.messages || [];
        // Reverse to get chronological order
        messages.reverse();
      }
      
      // Extract unique user IDs
      messages.forEach(msg => {
        if (msg.user) {
          userIds.add(msg.user);
        }
      });
      
      const threadInfo = {
        isThread,
        channelId,
        threadTs,
        messages,
        userCount: userIds.size,
        channelType,
        parentMessage
      };
      
      // Cache the result
      this._addToCache(cacheKey, threadInfo);
      
      logger.info(`Retrieved ${messages.length} messages from ${isThread ? 'thread' : 'DM'}`);
      return threadInfo;
    } catch (error) {
      logger.error(`Error fetching thread info: ${error.message}`);
      
      // Return a minimal thread info object
      return {
        isThread: false,
        channelId,
        threadTs,
        messages: [],
        userCount: 1,
        channelType: 'unknown',
        parentMessage: null
      };
    }
  }
  
  /**
   * Get item from cache
   * @param {string} key - Cache key
   * @returns {Object|null} - Cached item or null
   */
  _getFromCache(key) {
    if (!this.cache.has(key)) return null;
    
    const item = this.cache.get(key);
    const now = Date.now();
    
    if (now - item.timestamp > this.cacheExpiration) {
      // Expired
      this.cache.delete(key);
      return null;
    }
    
    return item.data;
  }
  
  /**
   * Add item to cache
   * @param {string} key - Cache key
   * @param {Object} data - Data to cache
   */
  _addToCache(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }
  
  /**
   * Clear cache for a specific thread
   * @param {string} threadTs - Thread timestamp
   * @param {string} channelId - Channel ID
   */
  clearCache(threadTs, channelId) {
    const cacheKey = `${channelId}:${threadTs}`;
    this.cache.delete(cacheKey);
    logger.info(`Cleared cache for thread ${threadTs}`);
  }
  
  /**
   * Truncate text to a maximum length
   * @param {string} text - Text to truncate
   * @param {number} maxLength - Maximum length
   * @returns {string} - Truncated text
   */
  _truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }
}

// Singleton instance
let instance = null;

/**
 * Get the singleton instance of ThreadContextBuilder
 * @returns {ThreadContextBuilder} - Singleton instance
 */
function getThreadContextBuilder() {
  if (!instance) {
    instance = new ThreadContextBuilder();
  }
  return instance;
}

module.exports = {
  ThreadContextBuilder,
  getThreadContextBuilder
}; 