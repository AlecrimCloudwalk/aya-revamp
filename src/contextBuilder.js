/**
 * ContextBuilder - A unified system for building and managing context for the LLM
 * 
 * This module handles the standardization of messages from various sources
 * (Slack API, LLM responses, button clicks, etc.) into a consistent format 
 * that can be used to build context for the LLM. It also manages thread-specific
 * state like tool executions, button states, and metadata.
 * 
 * Standard Context Structure
 * 
 * This documents the standard context structure used throughout the application.
 * It serves as a reference, not a constraint - fields can be added as needed.
 * 
 * @typedef {Object} ThreadContext
 * @property {string} threadId - Thread ID/timestamp
 * @property {string} [channelId] - Channel ID
 * @property {string} [userId] - User ID who initiated the request
 * @property {Object} [user] - User information
 * @property {string} user.id - User ID
 * @property {string} user.name - User name
 * @property {boolean} [isDirectMessage] - Whether this is a direct message
 * @property {Object} [channel] - Channel information
 * @property {Object[]} [messages] - Formatted messages in the thread
 * @property {Object} [metadata] - Additional metadata about the thread
 * @property {Object} [toolExecutions] - Record of tool executions
 * 
 * Message Structure
 * 
 * @typedef {Object} Message
 * @property {string} id - Message ID
 * @property {string} source - Source of the message (user, assistant, system, tool)
 * @property {string} text - Message text content
 * @property {string} timestamp - ISO timestamp
 * @property {string} threadTs - Thread timestamp
 * @property {Object} [originalContent] - Original message content from Slack
 * @property {Object} [metadata] - Additional metadata about the message
 */

const { logError } = require('./errors.js');
const logger = require('./toolUtils/logger.js');
const { formatTimestamp, formatRelativeTime, formatContextTimestamp } = require('./toolUtils/dateUtils.js');
const { calculateTextSimilarity } = require('./toolUtils/messageFormatUtils');
const crypto = require('crypto');

/**
 * Cache configuration
 */
const CACHE_CONFIG = {
  MAX_EXECUTIONS_PER_THREAD: 100,
  MAX_AGE_MS: 30 * 60 * 1000, // 30 minutes
  TOOLS_WITHOUT_EXPIRY: ['getThreadHistory', 'postMessage']
};

/**
 * Thread pruning configuration
 */
const THREAD_PRUNING = {
  MAX_MESSAGES: 75,        // Maximum messages before pruning
  TARGET_MESSAGES: 50,     // Target number to keep
  MIN_MESSAGES_TO_KEEP: 10, // Minimum to always keep
  ALWAYS_KEEP_TYPES: ['error', 'button_click'],
  ALWAYS_KEEP_FIRST_MESSAGE: true // Always keep thread parent
};

// Message types - extensible enum of supported message types
const MessageTypes = {
  TEXT: 'text',
  BUTTON: 'button_message',
  BUTTON_CLICK: 'button_click', 
  IMAGE: 'image',
  FILE: 'file',
  SYSTEM_NOTE: 'system_note'
};

// Message sources - where messages can come from
const MessageSources = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
  TOOL: 'tool'
};

/**
 * Creates a stable hash for a tool call including name and arguments
 * @param {string} toolName - Name of the tool
 * @param {Object} args - Tool arguments
 * @returns {string} - Hash string representing the tool call
 */
function hashToolCall(toolName, args) {
  // Create a normalized copy of args with keys sorted
  const normalizedArgs = normalizeObject(args || {});
  
  // Create a string representation
  const stringRepresentation = JSON.stringify({
    tool: toolName,
    args: normalizedArgs
  });
  
  // Create a hash
  return crypto.createHash('md5').update(stringRepresentation).digest('hex');
}

/**
 * Recursively normalizes an object for stable hashing
 * - Sorts keys alphabetically
 * - Handles nested objects and arrays
 * - Removes undefined values
 * @param {*} obj - Object to normalize
 * @returns {*} - Normalized object
 */
function normalizeObject(obj) {
  // Handle primitives and null
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(normalizeObject);
  }
  
  // Handle objects
  const normalized = {};
  const sortedKeys = Object.keys(obj).sort();
  
  for (const key of sortedKeys) {
    // Skip undefined values
    if (obj[key] !== undefined) {
      normalized[key] = normalizeObject(obj[key]);
    }
  }
  
  return normalized;
}

/**
 * Format blocks and attachments into a readable text representation
 * @param {Object} message - The message with blocks/attachments
 * @returns {string} Formatted text representation
 */
function formatRichContent(message) {
  let formattedText = '';
  
  // Process blocks
  if (message.blocks && Array.isArray(message.blocks)) {
    formattedText += formatBlocks(message.blocks);
  }
  
  // Process attachments
  if (message.attachments && Array.isArray(message.attachments)) {
    message.attachments.forEach(attachment => {
      // Process attachment blocks
      if (attachment.blocks && Array.isArray(attachment.blocks)) {
        formattedText += formatBlocks(attachment.blocks);
      }
      
      // Extract text content from attachment
      if (attachment.text) {
        formattedText += `\n${attachment.text}`;
      }
      
      // Extract fallback content if present
      if (attachment.fallback && !formattedText.includes(attachment.fallback)) {
        formattedText += `\n${attachment.fallback}`;
      }
    });
  }
  
  return formattedText.trim();
}

/**
 * Format blocks into readable text
 * @param {Array} blocks - Slack blocks
 * @returns {string} Text representation
 */
function formatBlocks(blocks) {
  let text = '';
  
  if (!blocks || !Array.isArray(blocks)) {
    return text;
  }
  
  blocks.forEach(block => {
    switch (block.type) {
      case 'header':
        if (block.text?.text) {
          text += `\n## ${block.text.text}`;
        }
        break;
        
      case 'section':
        if (block.text?.text) {
          text += `\n${block.text.text}`;
        }
        
        // Handle fields
        if (block.fields && Array.isArray(block.fields)) {
          block.fields.forEach(field => {
            if (field.text) {
              text += `\n${field.text}`;
            }
          });
        }
        break;
        
      case 'actions':
        // Special handling for buttons
        if (block.elements && Array.isArray(block.elements)) {
          const buttons = block.elements
            .filter(el => el.type === 'button')
            .map(btn => {
              const buttonText = btn.text?.text || 'Button';
              const buttonValue = btn.value || '';
              return `[${buttonText}${buttonValue ? ': ' + buttonValue : ''}]`;
            });
            
          if (buttons.length > 0) {
            text += `\nButtons: ${buttons.join(', ')}`;
          }
        }
        break;
        
      case 'context':
        if (block.elements && Array.isArray(block.elements)) {
          block.elements.forEach(element => {
            if (element.type === 'mrkdwn' || element.type === 'plain_text') {
              text += `\n_${element.text}_`;
            } else if (element.type === 'image') {
              text += `\n[Image: ${element.alt_text || 'No description'}]`;
            }
          });
        }
        break;
        
      case 'divider':
        text += '\n---';
        break;
        
      case 'image':
        text += `\n[Image: ${block.alt_text || block.title?.text || 'No description'}]`;
        break;
        
      default:
        // If block has text, use it
        if (block.text?.text) {
          text += `\n${block.text.text}`;
        }
    }
  });
  
  return text;
}

/**
 * Validates a context object and logs warnings for missing fields
 * Note: This is for debugging purposes and does NOT restrict fields
 * @param {Object} context - Context object to validate
 * @param {string} location - Where validation is occurring 
 * @returns {Object} - Same context object (never modified)
 */
function validateContext(context, location = 'unknown') {
  // Critical fields that should always be present
  const criticalFields = ['threadId'];
  
  // Recommended fields
  const recommendedFields = ['channelId', 'userId'];
  
  // Check critical fields
  for (const field of criticalFields) {
    if (!context[field]) {
      logger.warn(`Missing critical field '${field}' in context at ${location}`);
    }
  }
  
  // Check recommended fields
  for (const field of recommendedFields) {
    if (!context[field]) {
      logger.debug(`Missing recommended field '${field}' in context at ${location}`);
    }
  }
  
  // Return the unchanged context
  return context;
}

/**
 * Class to build and manage context for the LLM
 */
class ContextBuilder {
  constructor() {
    // Message store - maps message IDs to message objects
    this.messages = new Map();
    
    // Thread message mapping - maps thread IDs to arrays of message IDs
    this.threadMessages = new Map();
    
    // Thread metadata - maps thread IDs to metadata objects
    this.threadMetadata = new Map();
    
    // Tool execution history - maps thread IDs to arrays of tool execution details
    this.toolExecutions = new Map();
    
    // Timeline sequence counter - maps thread IDs to current sequence number
    this.sequenceCounters = new Map();
    
    // Timeline grouping - maps message IDs to their sequence numbers
    this.messageSequences = new Map();
    
    // Tool to message mapping - maps tool execution IDs to message IDs
    this.toolToMessageMap = new Map();
    
    // Tool execution cache - maps threadId -> {hashToExecution, executions}
    this.toolExecutionCache = new Map();
    
    this.buttonStates = new Map(); // ThreadTS -> Map of button states 
    this.debug = process.env.DEBUG_CONTEXT === 'true';
    
    logger.info('ContextBuilder initialized');
  }
  
  /**
   * Get the next sequence number for a thread
   * @param {string} threadTs - Thread timestamp
   * @returns {number} - Next sequence number
   */
  getNextSequence(threadTs) {
    // Initialize counter for thread if not exists
    if (!this.sequenceCounters.has(threadTs)) {
      this.sequenceCounters.set(threadTs, 0);
    }
    
    // Get current counter and increment
    const counter = this.sequenceCounters.get(threadTs);
    this.sequenceCounters.set(threadTs, counter + 1);
    
    return counter;
  }

  /**
   * Records a tool execution with hash-based caching
   */
  recordToolExecution(threadId, toolName, args, result, error = null, skipped = false) {
    // Initialize tool executions array for thread if not exists
    if (!this.toolExecutions.has(threadId)) {
      this.toolExecutions.set(threadId, []);
    }
    
    // Get or initialize tool execution cache for thread
    if (!this.toolExecutionCache.has(threadId)) {
      this.toolExecutionCache.set(threadId, {
        hashToExecution: new Map(),
        executions: []
      });
    }
    
    const cache = this.toolExecutionCache.get(threadId);
    
    // Create hash for the tool call
    const hash = hashToolCall(toolName, args);
    
    // Create execution record
    const execution = {
      toolName,
      args,
      result,
      error,
      skipped,
      timestamp: new Date().toISOString(),
      hash
    };
    
    // Add to cache by hash
    cache.hashToExecution.set(hash, execution);
    
    // Add to chronological list
    cache.executions.push(execution);
    
    // Add to existing tool executions array (for backward compatibility)
    const toolExecutions = this.toolExecutions.get(threadId);
    toolExecutions.push(execution);
    
    // Check if we should prune cache after adding new execution
    if (cache.executions.length > CACHE_CONFIG.MAX_EXECUTIONS_PER_THREAD) {
      this.pruneToolExecutionCache(threadId);
    }
    
    if (this.debug) {
      logger.info(`Recorded tool execution for ${threadId}: ${toolName}`);
    }
  }
  
  /**
   * Prunes tool execution cache for a thread
   */
  pruneToolExecutionCache(threadId) {
    const cache = this.toolExecutionCache.get(threadId);
    if (!cache) return;
    
    const now = Date.now();
    const cutoffTime = new Date(now - CACHE_CONFIG.MAX_AGE_MS).toISOString();
    
    // Filter executions by age and special tools
    const validExecutions = cache.executions.filter(execution => {
      // Never expire certain tools
      if (CACHE_CONFIG.TOOLS_WITHOUT_EXPIRY.includes(execution.toolName)) {
        return true;
      }
      
      return execution.timestamp >= cutoffTime;
    });
    
    // Limit to max size
    const finalExecutions = validExecutions.slice(
      Math.max(0, validExecutions.length - CACHE_CONFIG.MAX_EXECUTIONS_PER_THREAD)
    );
    
    // Rebuild hash map
    const newHashMap = new Map();
    for (const execution of finalExecutions) {
      newHashMap.set(execution.hash, execution);
    }
    
    // Update cache
    cache.executions = finalExecutions;
    cache.hashToExecution = newHashMap;
    
    // Log the pruning operation
    if (this.debug) {
      const prunedCount = cache.executions.length - finalExecutions.length;
      if (prunedCount > 0) {
        logger.info(`Pruned ${prunedCount} tool executions from thread ${threadId}`);
      }
    }
  }
  
  /**
   * Checks if a tool has already been executed with given arguments
   */
  hasExecuted(threadId, toolName, args = {}) {
    // Get cache
    const cache = this.toolExecutionCache.get(threadId);
    if (!cache) return false;
    
    // Create hash for lookup
    const hash = hashToolCall(toolName, args);
    
    // Check cache
    return cache.hashToExecution.has(hash);
  }
  
  /**
   * Gets the result of a previous tool execution
   */
  getToolResult(threadId, toolName, args = {}) {
    // Get cache
    const cache = this.toolExecutionCache.get(threadId);
    if (!cache) return null;
    
    // Create hash for lookup
    const hash = hashToolCall(toolName, args);
    
    // Check cache
    const execution = cache.hashToExecution.get(hash);
    return execution ? execution.result : null;
  }
  
  /**
   * Add a message to the context builder
   * @param {Object} message - Message object to add
   * @returns {Object} - Added message
   */
  addMessage(message) {
    try {
      // Generate a message ID if not provided
      if (!message.id) {
        const randomId = Math.random().toString(36).substring(2, 8);
        message.id = `msg_${Date.now()}_${randomId}`;
      }
      
      // Set timestamp if not provided
      if (!message.timestamp) {
        message.timestamp = new Date().toISOString();
      }
      
      // Make sure threadTs is set
      if (!message.threadTs) {
        logger.warn(`Adding message without threadTs: ${message.id}`);
      }
      
      // Process the message by type
      const processedMessage = this._processMessage(message);
      
      // Check if the message was processed correctly
      if (!processedMessage) {
        logger.error(`Failed to process message: ${JSON.stringify(message)}`);
        return message;
      }
      
      // Add message to the general message map
      this.messages.set(processedMessage.id, processedMessage);
      logger.info(`Added message to messages map with ID: ${processedMessage.id}`);
      
      // Add to thread-specific list if threadTs is provided
      if (processedMessage.threadTs) {
        // Get existing thread messages or create a new array
        if (!this.threadMessages.has(processedMessage.threadTs)) {
          this.threadMessages.set(processedMessage.threadTs, []);
          logger.info(`Created new thread entry for ${processedMessage.threadTs}`);
        }
        
        // Get the messages array for this thread
        const threadMsgs = this.threadMessages.get(processedMessage.threadTs);
        
        // Add to thread-specific list
        threadMsgs.push(processedMessage.id);
        
        // Update the map
        this.threadMessages.set(processedMessage.threadTs, threadMsgs);
        logger.info(`Added message ${processedMessage.id} to thread ${processedMessage.threadTs} (now has ${threadMsgs.length} messages)`);
      } else {
        logger.warn(`Message has no threadTs, not adding to any thread: ${processedMessage.id}`);
      }
      
      // Save a copy of recent messages for duplicate detection
      if (processedMessage.text && processedMessage.source === 'assistant') {
        const recentMessages = this.getMetadata(processedMessage.threadTs, 'recentMessages') || [];
        recentMessages.unshift({
          text: processedMessage.text,
          timestamp: processedMessage.timestamp,
          id: processedMessage.id
        });
        
        // Keep only the last 5
        const trimmedRecent = recentMessages.slice(0, 5);
        
        // Store in metadata
        this.setMetadata(processedMessage.threadTs, 'recentMessages', trimmedRecent);
      }
      
      // Return the processed message
      return processedMessage;
    } catch (error) {
      logger.error(`Error adding message: ${error.message}`);
      logger.error(error.stack);
      return message;
    }
  }
  
  /**
   * Process a message by its type and source
   * @param {Object} message - Message to process
   * @returns {Object} - Processed message
   * @private
   */
  _processMessage(message) {
    try {
      logger.info(`Processing message of source: ${message.source}, type: ${message.type || 'unspecified'}`);
      
      // Normalize message structure
      const baseMessage = {
        ...message,
        id: message.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp: message.timestamp || new Date().toISOString(),
        text: message.text || ''
      };
      
      // Process by source
      if (message.source === 'slack') {
        return this._processSlackMessage(baseMessage);
      } else if (message.source === 'llm' || message.source === 'assistant') {
        return this._processLLMMessage(baseMessage);
      } else if (message.source === 'system') {
        return this._processSystemMessage(baseMessage);
      } else if (message.type === 'button_click') {
        return this._processButtonClick(baseMessage);
      }
      
      // Log if we don't recognize the message type
      if (!['user', 'tool'].includes(message.source)) {
        logger.warn(`Unknown message source: ${message.source}, passing through`);
      }
      
      logger.info(`Message processed successfully, ID: ${baseMessage.id}`);
      
      // Return the message as is if not handled specifically
      return baseMessage;
    } catch (error) {
      logger.error(`Error processing message: ${error.message}`);
      logger.error(error.stack);
      return message; // Return original message on error
    }
  }
  
  /**
   * Process a Slack message
   * @param {Object} message - Slack message data
   * @returns {Object} - Standardized context message
   */
  _processSlackMessage(message) {
    const slackMsg = message.originalContent || message;
    const isBot = slackMsg.bot_id || (slackMsg.user === process.env.BOT_USER_ID);
    
    // Extract text content
    let textContent = slackMsg.text || '';
    
    // If it has blocks or attachments, extract rich content
    if ((slackMsg.blocks && slackMsg.blocks.length > 0) || 
        (slackMsg.attachments && slackMsg.attachments.length > 0)) {
      const richContent = formatRichContent(slackMsg);
      if (richContent) {
        textContent = richContent;
      }
    }
    
    // Determine message type
    let messageType = MessageTypes.TEXT;
    
    // Check if this is a message with buttons
    if (slackMsg.attachments?.some(a => a.blocks?.some(b => b.type === 'actions')) ||
        slackMsg.blocks?.some(b => b.type === 'actions')) {
      messageType = MessageTypes.BUTTON;
    }
    
    return {
      id: slackMsg.ts || `slack_${Date.now()}`,
      timestamp: new Date((slackMsg.ts * 1000) || Date.now()).toISOString(),
      threadTs: slackMsg.thread_ts || slackMsg.ts,
      source: isBot ? MessageSources.ASSISTANT : MessageSources.USER,
      sourceId: isBot ? 'bot' : slackMsg.user,
      originalContent: slackMsg,
      text: textContent || 'Message with no text content',
      type: messageType,
      metadata: {
        channel: slackMsg.channel,
        isBot: isBot,
        hasAttachments: !!slackMsg.attachments?.length,
        hasBlocks: !!slackMsg.blocks?.length
      }
    };
  }
  
  /**
   * Process an LLM-generated message
   * @param {Object} message - LLM message data
   * @returns {Object} - Standardized context message
   */
  _processLLMMessage(message) {
    const llmResponse = message.llmResponse || message.originalContent || {};
    
    // Try to get a meaningful message ID
    const messageId = message.id || 
                     (message.slackResult?.ts ? `slack_${message.slackResult.ts}` : `llm_${Date.now()}`);
    
    let messageType = MessageTypes.TEXT;
    let messageText = '';
    
    // Extract content based on the tool type
    if (llmResponse.tool === 'postMessage') {
      messageText = llmResponse.parameters?.text || 'Message with no text content';
      
      // Check if this is a button message
      if (messageText.includes('#buttons:') || 
          messageText.includes('buttons:') ||
          (llmResponse.parameters?.buttons && Array.isArray(llmResponse.parameters.buttons))) {
        messageType = MessageTypes.BUTTON;
      }
    } else if (llmResponse.tool === 'createButtonMessage') {
      messageType = MessageTypes.BUTTON;
      
      // Construct a text representation of the button message
      const buttonParams = llmResponse.parameters || {};
      messageText = buttonParams.text || 'Button message';
      
      if (buttonParams.buttons && Array.isArray(buttonParams.buttons)) {
        const buttonTexts = buttonParams.buttons.map(btn => {
          if (typeof btn === 'string') return btn;
          return btn.text || btn.value || 'Button';
        });
        
        messageText += `\nButtons: ${buttonTexts.join(', ')}`;
      }
    }
    
    return {
      id: messageId,
      timestamp: message.timestamp || new Date().toISOString(),
      threadTs: message.threadTs,
      source: MessageSources.ASSISTANT,
      sourceId: 'llm',
      originalContent: message.originalContent || llmResponse,
      llmResponse: llmResponse,
      text: messageText,
      type: messageType,
      slackMessageId: message.slackResult?.ts,
      metadata: {
        tool: llmResponse.tool,
        reasoning: llmResponse.reasoning,
        hasButtons: messageType === MessageTypes.BUTTON
      }
    };
  }
  
  /**
   * Process a button click
   * @param {Object} message - Button click data
   * @returns {Object} - Standardized context message
   */
  _processButtonClick(message) {
    const payload = message.originalContent || message;
    const buttonValue = payload.value || 
                        (payload.actions && payload.actions[0] ? payload.actions[0].value : 'unknown');
    const buttonText = payload.text?.text || 
                      (payload.actions && payload.actions[0] && payload.actions[0].text ? 
                       payload.actions[0].text.text : buttonValue);
    
    return {
      id: `btn_${Date.now()}`,
      timestamp: message.timestamp || new Date().toISOString(),
      threadTs: message.threadTs || payload.message?.thread_ts || payload.container?.message_ts,
      source: MessageSources.USER,
      sourceId: payload.user?.id || message.userId,
      originalContent: payload,
      text: `[Button Selection: ${buttonText}]`,
      type: MessageTypes.BUTTON_CLICK,
      visuallyAcknowledged: message.visuallyAcknowledged || false,
      metadata: {
        buttonValue: buttonValue,
        buttonText: buttonText,
        messageTs: payload.message?.ts || payload.container?.message_ts,
        channelId: payload.channel?.id
      }
    };
  }
  
  /**
   * Process a system message
   * @param {Object} message - System message data
   * @returns {Object} - Standardized context message
   */
  _processSystemMessage(message) {
    return {
      id: message.id || `sys_${Date.now()}`,
      timestamp: message.timestamp || new Date().toISOString(),
      threadTs: message.threadTs,
      source: MessageSources.SYSTEM,
      sourceId: message.sourceId || 'system',
      originalContent: message.originalContent || message,
      text: message.text || 'System message',
      type: message.type || MessageTypes.SYSTEM_NOTE,
      metadata: message.metadata || {}
    };
  }
  
  /**
   * Set button state
   * @param {string} threadTs - Thread timestamp
   * @param {string} actionId - ID of the button action
   * @param {string} state - State of the button ('active', 'clicked', etc)
   * @param {Object} metadata - Additional metadata for the button
   */
  setButtonState(threadTs, actionId, state, metadata = null) {
    try {
      // Get or create the button states map for this thread
      if (!this.buttonStates.has(threadTs)) {
        this.buttonStates.set(threadTs, new Map());
      }
      
      const threadButtonStates = this.buttonStates.get(threadTs);
      
      // Set the button state
      threadButtonStates.set(actionId, { state, metadata });
      logger.info(`Set button ${actionId} state to ${state} in thread ${threadTs}`);
      return true;
    } catch (error) {
      logger.error(`Error setting button state: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Get button state
   * @param {string} threadTs - Thread timestamp
   * @param {string} actionId - ID of the button action
   * @returns {Object} - Button state data
   */
  getButtonState(threadTs, actionId) {
    try {
      if (!this.buttonStates.has(threadTs)) return null;
      
      return this.buttonStates.get(threadTs).get(actionId) || null;
    } catch (error) {
      logger.error(`Error getting button state: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Set metadata for a thread
   * @param {string} threadTs - Thread timestamp
   * @param {string} key - Metadata key
   * @param {any} value - Metadata value
   */
  setMetadata(threadTs, key, value) {
    try {
      // Get or create the metadata map for this thread
      if (!this.threadMetadata.has(threadTs)) {
        this.threadMetadata.set(threadTs, new Map());
      }
      
      const threadMetadata = this.threadMetadata.get(threadTs);
      
      // Set the metadata
      threadMetadata.set(key, value);
      
      // Special handling for context metadata to extract channel
      if (key === 'context' && value && value.channelId) {
        threadMetadata.set('channelId', value.channelId);
      }
      
      return true;
    } catch (error) {
      logger.error(`Error setting metadata: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Get metadata for a thread
   * @param {string} threadTs - Thread timestamp
   * @param {string} key - Metadata key
   * @returns {any} - Metadata value
   */
  getMetadata(threadTs, key) {
    try {
      if (!this.threadMetadata.has(threadTs)) return null;
      
      return this.threadMetadata.get(threadTs).get(key) || null;
    } catch (error) {
      logger.error(`Error getting metadata: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Get channel ID for a thread
   * @param {string} threadTs - Thread timestamp
   * @returns {string} - Channel ID
   */
  getChannel(threadTs) {
    // Try to get from context metadata first (most reliable)
    const context = this.getMetadata(threadTs, 'context');
    if (context && context.channelId) {
      return context.channelId;
    }
    
    // Try direct metadata
    const channelId = this.getMetadata(threadTs, 'channelId');
    if (channelId) {
      return channelId;
    }
    
    // Try to parse from threadTs if it's in format channelId:timestamp
    if (threadTs && threadTs.includes(':')) {
      return threadTs.split(':')[0];
    }
    
    // Fall back to threadTs if it looks like a channel ID
    if (threadTs && (threadTs.startsWith('C') || threadTs.startsWith('D'))) {
      return threadTs;
    }
    
    return null;
  }
  
  /**
   * Get thread timestamp for a thread context
   * @param {string} threadTs - Thread identifier (might be threadId with channel)
   * @returns {string} - Clean thread timestamp
   */
  getThreadTs(threadTs) {
    // Check if we have context with threadTs
    const context = this.getMetadata(threadTs, 'context');
    if (context && context.threadTs) {
      return context.threadTs;
    }
    
    // If threadTs contains a timestamp part, use that
    if (threadTs && threadTs.includes(':')) {
      return threadTs.split(':')[1];
    }
    
    // Otherwise return threadTs directly
    return threadTs;
  }
  
  /**
   * Get state summary for LLM
   * @param {string} threadTs - Thread timestamp
   * @returns {Object} - State summary
   */
  getStateForLLM(threadTs) {
    try {
      return {
        threadTs: this.getThreadTs(threadTs),
        channelId: this.getChannel(threadTs),
        sentMessagesCount: (this.getMetadata(threadTs, 'sentMessages') || []).length,
        activeButtons: this.getActiveButtons(threadTs),
        recentToolResults: this.getToolExecutionHistory(threadTs, 5)
          .map(exec => ({
            execution: exec.toolName,
            success: !exec.error
          }))
      };
    } catch (error) {
      logger.error(`Error getting state for LLM: ${error.message}`);
      return {
        threadTs,
        error: 'Failed to build state summary'
      };
    }
  }
  
  /**
   * Get all active buttons for a thread
   * @param {string} threadTs - Thread timestamp
   * @returns {Array} - Array of active button info
   */
  getActiveButtons(threadTs) {
    try {
      if (!this.buttonStates.has(threadTs)) return [];
      
      const threadButtonStates = this.buttonStates.get(threadTs);
      
      return Array.from(threadButtonStates.entries())
        .filter(([_, data]) => data.state === 'active')
        .map(([actionId, data]) => ({
          actionId,
          metadata: data.metadata
        }));
    } catch (error) {
      logger.error(`Error getting active buttons: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Get a summary of the thread with message counts
   * @param {string} threadTs - Thread timestamp
   * @returns {Object} - Thread summary
   */
  getThreadSummary(threadTs) {
    try {
      if (!this.threadMessages.has(threadTs)) {
        return {
          threadTs,
          counts: {
            total: 0,
            user: 0,
            assistant: 0,
            system: 0
          },
          isEmpty: true
        };
      }
      
      const threadMsgs = this.threadMessages.get(threadTs);
      
      // Count message types
      let userCount = 0;
      let assistantCount = 0;
      let systemCount = 0;
      
      for (const msgId of threadMsgs) {
        const msg = this.messages.get(msgId);
        if (!msg) continue;
        
        if (msg.source === MessageSources.USER) {
          userCount++;
        } else if (msg.source === MessageSources.ASSISTANT) {
          assistantCount++;
        } else if (msg.source === MessageSources.SYSTEM) {
          systemCount++;
        }
      }
      
      return {
        threadTs,
        counts: {
          total: threadMsgs.length,
          user: userCount,
          assistant: assistantCount,
          system: systemCount
        },
        isEmpty: threadMsgs.length === 0,
        hasUserMessages: userCount > 0
      };
    } catch (error) {
      logger.error(`Error getting thread summary: ${error.message}`);
      return {
        threadTs,
        counts: {
          total: 0,
          user: 0,
          assistant: 0,
          system: 0
        },
        isEmpty: true,
        error: error.message
      };
    }
  }
  
  /**
   * Extract user ID from a message
   * @param {Object} message - Message object
   * @returns {string} - User ID
   */
  _extractUserId(message) {
    // First try to get from sourceId
    if (message.sourceId && message.sourceId.startsWith('U')) {
      return message.sourceId;
    }
    
    // Then try to extract from text if it contains a mention
    if (message.text) {
      const userIdMatch = message.text.match(/<@([A-Z0-9]+)>/);
      if (userIdMatch && userIdMatch[1]) {
        return userIdMatch[1];
      }
    }
    
    // If metadata exists, check there
    if (message.metadata && message.metadata.userId) {
      return message.metadata.userId;
    }
    
    // If thread metadata exists, check for user info
    if (message.threadTs && this.threadMetadata.has(message.threadTs)) {
      const metadata = this.threadMetadata.get(message.threadTs);
      if (metadata.context && metadata.context.user && metadata.context.user.id) {
        return metadata.context.user.id;
      }
    }
    
    // Use default USER ID as fallback
    return 'USER';
  }
  
  /**
   * Formats a message for the LLM in a standardized format
   * @param {Object} message - Message to format
   * @param {number} index - Message index for ordering
   * @returns {Object|null} - Formatted message for LLM
   * @private
   */
  _formatMessageForLLM(message, index) {
    try {
      if (!message) {
        logger.warn('Attempted to format undefined/null message');
        return null;
      }
      
      // Log message details for debugging
      logger.info(`Formatting message for LLM: ${message.id} (source: ${message.source || 'undefined'})`);
      
      // Normalize message source to handle different formats
      let sourceType = typeof message.source === 'string' ? message.source.toLowerCase() : 'unknown';
      
      // Determine the appropriate role based on source
      let role = 'system';  // Default role
      if (sourceType === 'user') {
        role = 'user';
      } else if (['assistant', 'bot', 'llm'].includes(sourceType)) {
        role = 'assistant';
      } else if (sourceType === 'tool') {
        role = 'function';  // For tool calls/responses
      }
      
      // Format content based on role
      let content;
      if (role === 'user') {
        // For user messages, use an object with text and userid
        // Strip out dev key if present
        let textContent = message.text || '';
        if (textContent.startsWith('!@#')) {
          textContent = textContent.substring(3).trim();
          logger.info(`Stripped dev key from user message before sending to LLM: ${textContent}`);
        }
        
        content = {
          text: textContent,
          userid: message.sourceId || 'unknown'
        };
      } else if (role === 'assistant' && message.llmResponse) {
        // For assistant messages with tool call data
        content = message.text || '';
        // Include reasoning if available
        if (message.llmResponse?.reasoning) {
          content += `\n\nReasoning: ${message.llmResponse.reasoning}`;
        }
      } else if (role === 'assistant') {
        // For assistant messages without tool call data
        // Make sure we always have message content, not an empty string
        content = message.text || 'Assistant response';
        logger.info(`Formatted assistant message content: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`);
      } else {
        // For system or other messages, use text directly
        content = message.text || '';
      }
      
      // Return formatted message object
      return {
        role,
        content,
        timestamp: message.timestamp || new Date().toISOString(),
        turn: index + 1
      };
    } catch (error) {
      logger.error(`Error formatting message for LLM: ${error.message}`);
      
      // Return a safe default if formatting fails
      return {
        role: 'system',
        content: `Error formatting message: ${error.message}`,
        timestamp: new Date().toISOString(),
        turn: index + 1
      };
    }
  }
  
  /**
   * Format a tool execution for LLM consumption
   * @param {Object} tool - Tool execution to format
   * @param {number} index - Index in the context sequence
   * @returns {Object|null} - Formatted tool execution object or null if invalid
   */
  _formatToolExecutionForLLM(tool, index) {
    if (!tool) return null;
    
    const formattedTime = formatContextTimestamp(tool.timestamp);
    
    // Format: [4] DD/MM/YYYY HH:mm - BOT TOOL CALL: toolName, reasoning: "explanation", STATUS
    const reasoning = tool.reasoning || 'No reasoning provided';
    const status = tool.skipped ? 'SKIPPED' : (tool.error ? 'ERROR' : 'SUCCESS');
    
    // Add skipped info
    const skippedInfo = tool.skipped ? ' (Tool call skipped - identical parameters to previous call)' : '';
    
    const formattedString = `[${index}] ${formattedTime} - BOT TOOL CALL: ${tool.toolName}, reasoning: "${reasoning}", ${status}${skippedInfo}`;
    
    return {
      role: 'system',
      source: 'tool',
      formattedString,
      raw: `Tool ${tool.toolName} called: ${status}${skippedInfo}`
    };
  }
  
  /**
   * Prunes thread history when it gets too long
   * @param {string} threadTs - Thread timestamp
   * @returns {number} - Number of messages removed
   */
  pruneThreadHistory(threadTs) {
    // Get messages for the thread
    const messages = this.getThreadMessages(threadTs);
    if (!messages || messages.length <= THREAD_PRUNING.MIN_MESSAGES_TO_KEEP) {
      return 0; // Nothing to prune
    }
    
    // Only prune if we're over the limit
    if (messages.length <= THREAD_PRUNING.MAX_MESSAGES) {
      return 0;
    }
    
    // Determine which messages to keep
    const messagesToKeep = [];
    
    // Always keep the first message (thread parent)
    if (THREAD_PRUNING.ALWAYS_KEEP_FIRST_MESSAGE && messages.length > 0) {
      messagesToKeep.push(messages[0]);
    }
    
    // First pass - keep critical message types
    for (const msgId of messages) {
      const msg = this.messages.get(msgId);
      if (!msg) continue;
      
      if (THREAD_PRUNING.ALWAYS_KEEP_TYPES.includes(msg.type)) {
        messagesToKeep.push(msgId);
      }
    }
    
    // Second pass - keep most recent messages to reach target
    const remainingToKeep = THREAD_PRUNING.TARGET_MESSAGES - messagesToKeep.length;
    if (remainingToKeep > 0) {
      // Create a set of already kept messages for quick lookup
      const keptSet = new Set(messagesToKeep);
      
      // Add the most recent messages not already kept
      const recentMessages = messages
        .slice(-remainingToKeep)
        .filter(msgId => !keptSet.has(msgId));
      
      messagesToKeep.push(...recentMessages);
    }
    
    // Create a set for efficient lookup
    const keepSet = new Set(messagesToKeep);
    
    // Create new thread messages list
    const newThreadMessages = messages.filter(msgId => keepSet.has(msgId));
    
    // Calculate how many we removed
    const removedCount = messages.length - newThreadMessages.length;
    
    // Update thread messages
    if (removedCount > 0) {
      this.threadMessages.set(threadTs, newThreadMessages);
      
      // Add a system message about pruning
      this.addMessage({
        source: 'system',
        originalContent: { pruned: removedCount },
        id: `prune_${Date.now()}`,
        timestamp: new Date().toISOString(),
        threadTs,
        text: `${removedCount} older messages have been summarized to optimize context.`,
        type: 'system_note',
        metadata: { isPruneNotice: true }
      });
      
      logger.info(`Pruned ${removedCount} messages from thread ${threadTs}`);
    }
    
    return removedCount;
  }
  
  /**
   * Builds context for the LLM for a specific thread in the new JSON format
   * @param {string} threadTs - Thread timestamp
   * @param {Object} options - Build options
   * @returns {Array} - Messages array for LLM
   */
  buildFormattedLLMContext(threadTs, options = {}) {
    try {
      // Add verbose logging for empty context diagnosis
      logger.info(`Building context for thread: ${threadTs}`);
      logger.info(`Thread exists in threadMessages: ${this.threadMessages.has(threadTs)}`);
      
      if (this.threadMessages.has(threadTs)) {
        const messageCount = this.threadMessages.get(threadTs)?.length || 0;
        logger.info(`Thread has ${messageCount} message IDs stored`);
      } else {
        logger.error(`⚠️ CONTEXT ERROR: Thread ${threadTs} not found in threadMessages map`);
        // Print all available thread IDs for debugging
        logger.info(`Available thread IDs: ${Array.from(this.threadMessages.keys()).join(', ')}`);
      }

      // Check if we should prune first
      const messageCount = this.getThreadMessages(threadTs)?.length || 0;
      
      if (messageCount > THREAD_PRUNING.MAX_MESSAGES) {
        this.pruneThreadHistory(threadTs);
      }
      
      const { limit = 25, includeBotMessages = true, includeToolCalls = true, skipLogging = false } = options;
      
      if (!threadTs || !this.threadMessages.has(threadTs)) {
        logger.warn(`No messages found for thread ${threadTs}`);
        return [];
      }
      
      // Get all message IDs for this thread
      const messageIds = this.getThreadMessages(threadTs);
      
      // Get the actual message objects
      const rawMessages = [];
      
      // Directly access actual messages since mapping is failing
      for (const msgId of messageIds) {
        const msg = this.messages.get(msgId);
        if (msg) {
          // Log for debugging
          logger.info(`Found message ${msgId}, source=${msg.source}, type=${msg.type || 'unspecified'}`);
          rawMessages.push(msg);
        } else {
          logger.warn(`Message not found for ID: ${msgId}`);
        }
      }
      
      // Log details about the raw messages retrieved
      logger.info(`Found ${rawMessages.length} raw messages for thread ${threadTs}`);
      
      // DEBUG: Add detailed logging of raw messages
      rawMessages.forEach((msg, idx) => {
        logger.info(`Raw message ${idx}: source=${msg.source}, type=${msg.type || 'unspecified'}, id=${msg.id}`);
      });
      
      // Filter and format each message
      const jsonContext = rawMessages
        .filter(msg => {
          // Add detailed filtering logs
          // First, ensure message has a source - default to 'system' if missing
          if (!msg.source) {
            logger.info(`Message ${msg.id} has no source, defaulting to 'system'`);
            msg.source = 'system';
          }
          
          // Normalize source to handle both object and string sources
          const sourceNormalized = typeof msg.source === 'string' ? msg.source.toLowerCase() : 'unknown';
          
          const sourceMatch = sourceNormalized === 'user';
          const botMatch = (sourceNormalized === 'assistant' || sourceNormalized === 'bot') && includeBotMessages;
          const toolMatch = sourceNormalized === 'tool' && includeToolCalls;
          const errorMatch = sourceNormalized === 'system' && msg.type === 'error';
          const buttonMatch = (msg.type === 'button_click' || msg.type === 'button');
          
          // Add special case for system messages which should be included by default
          const systemMatch = sourceNormalized === 'system';
          
          logger.info(`Message ${msg.id} filtering: source=${sourceNormalized}, type=${msg.type || 'unspecified'}`);
          logger.info(`  sourceMatch=${sourceMatch}, botMatch=${botMatch}, toolMatch=${toolMatch}, errorMatch=${errorMatch}, buttonMatch=${buttonMatch}, systemMatch=${systemMatch}`);
          
          // Include anything that matches our criteria
          const result = sourceMatch || botMatch || toolMatch || errorMatch || buttonMatch || systemMatch;
          
          if (!result) {
            logger.info(`  ❌ Message ${msg.id} filtered out`);
          } else {
            logger.info(`  ✅ Message ${msg.id} included`);
          }
          
          return result;
        })
        .map((msg, index) => {
          const formatted = this._formatMessageForLLM(msg, index);
          if (!formatted) {
            logger.info(`Message ${msg.id} formatting failed`);
          }
          return formatted;
        })
        .filter(Boolean);  // Remove any null/undefined formatted messages
      
      // Log filtered count to identify filtering issues
      logger.info(`After filtering and formatting: ${jsonContext.length} messages`);
      
      // If context is still empty, try a fallback approach
      if (jsonContext.length === 0) {
        logger.warn(`⚠️ No messages passed filtering for thread ${threadTs}, trying fallback`);
        
        // Try to bypass the filter entirely as a last resort
        logger.info(`Attempting to bypass filtering entirely as last resort`);
        const emergencyContext = rawMessages.map((msg, index) => {
          // Force basic user/system message format
          const forcedMsg = {
            ...msg,
            source: msg.source || 'system',
            text: msg.text || 'No content',
            timestamp: msg.timestamp || new Date().toISOString(),
            id: msg.id || `emergency_${index}`
          };
          
          return {
            role: forcedMsg.source === 'user' ? 'user' : 'system',
            content: forcedMsg.source === 'user' 
              ? { text: forcedMsg.text, userid: forcedMsg.sourceId || 'unknown' }
              : forcedMsg.text,
            timestamp: forcedMsg.timestamp
          };
        }).filter(Boolean);
        
        logger.info(`Emergency bypass produced ${emergencyContext.length} context items`);
        
        if (emergencyContext.length > 0) {
          logger.info(`Using ${emergencyContext.length} emergency context items`);
          return emergencyContext;
        }
        
        // Add all messages without filtering as a fallback
        const fallbackContext = rawMessages
          .map((msg, index) => this._formatMessageForLLM(msg, index))
          .filter(Boolean);
          
        logger.info(`Fallback approach yielded ${fallbackContext.length} messages`);
        
        // If we have fallback messages, use them
        if (fallbackContext.length > 0) {
          logger.info(`Using ${fallbackContext.length} fallback messages`);
          return fallbackContext;
        }
      }
      
      if (!skipLogging && process.env.DEBUG_CONTEXT === 'true') {
        logger.info(`Formatted ${jsonContext.length} messages for LLM context`);
      }
      
      // Return the fully formatted JSON context
      return jsonContext;
    } catch (error) {
      logError('Error building LLM context', error, { threadTs });
      logger.error(`⚠️ CONTEXT ERROR: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Finds a tool call that is associated with a message
   * @param {Object} message - The message to find a tool call for
   * @param {Array} toolExecutions - Array of tool executions
   * @returns {Object|null} - The associated tool call or null
   * @private
   */
  _findAssociatedToolCall(message, toolExecutions) {
    if (!message || !toolExecutions || !Array.isArray(toolExecutions)) {
      return null;
    }
    
    // Look for a postMessage tool call that occurred just before this message
    const messageTime = new Date(message.timestamp);
    
    // Filter to only postMessage tools that happened within 5 seconds before the message
    const possibleMatches = toolExecutions.filter(tool => {
      if (tool.toolName !== 'postMessage') return false;
      
      const toolTime = new Date(tool.timestamp);
      const timeDiff = messageTime - toolTime; // Positive if message is after tool
      
      // Tool call should be at most 5 seconds before the message
      return timeDiff >= 0 && timeDiff < 5000;
    });
    
    // Sort by timestamp descending and take the closest one
    if (possibleMatches.length > 0) {
      return possibleMatches.sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp)
      )[0];
    }
    
    return null;
  }
  
  /**
   * Extracts parameters from a tool execution object
   * @param {Object} tool - The tool execution object
   * @returns {Object} - The extracted parameters
   * @private
   */
  _extractToolParameters(tool) {
    if (!tool || !tool.args) {
      return {};
    }
    
    // Exclude certain fields that shouldn't be in the parameters
    const excludedFields = ['toolName', 'reasoning', 'timestamp', 'sequence', 'error'];
    const parameters = {};
    
    Object.entries(tool.args).forEach(([key, value]) => {
      if (!excludedFields.includes(key)) {
        parameters[key] = value;
      }
    });
    
    return parameters;
  }
  
  /**
   * Gets tool execution history for a thread
   * @param {string} threadId - Thread ID
   * @param {number} limit - Maximum number of executions to return
   * @returns {Array} - Array of tool execution records
   */
  getToolExecutionHistory(threadId, limit = 10) {
    try {
      // Check if thread exists in tool executions
      if (!this.toolExecutions.has(threadId)) {
        return [];
      }
      
      // Get and limit the executions
      return this.toolExecutions.get(threadId)
        .slice(0, limit);
    } catch (error) {
      logger.error(`Error getting tool execution history: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Get all messages for a thread
   * @param {string} threadTs - Thread timestamp
   * @returns {Array} - Array of message IDs for the thread
   */
  getThreadMessages(threadTs) {
    try {
      logger.info(`DEBUG: threadMessages map has ${this.threadMessages.size} threads`);
      logger.info(`DEBUG: Keys in threadMessages: ${Array.from(this.threadMessages.keys()).join(', ')}`);
      
      // Check if the thread exists in the map
      if (!this.threadMessages.has(threadTs)) {
        // Try exact key comparison and then try number/string conversion
        const threadTsNum = parseFloat(threadTs);
        const keys = Array.from(this.threadMessages.keys());
        
        // Try to find a close match
        const closeMatch = keys.find(key => {
          const keyNum = parseFloat(key);
          return Math.abs(keyNum - threadTsNum) < 0.001; // Allow small floating point differences
        });
        
        if (closeMatch) {
          logger.info(`Found close match for thread ID ${threadTs} -> ${closeMatch}`);
          threadTs = closeMatch;
        } else {
          logger.warn(`No thread messages found for ${threadTs}`);
          return [];
        }
      }
      
      // Get message IDs for this thread
      const messageIds = this.threadMessages.get(threadTs) || [];
      logger.info(`Thread ${threadTs} has ${messageIds.length} message IDs`);
      
      // Get actual messages and count how many we found
      const actualMessages = messageIds
        .map(id => this.messages.get(id))
        .filter(Boolean);
      logger.info(`Retrieved ${actualMessages.length} actual messages from ${messageIds.length} IDs`);
      
      return messageIds;
    } catch (error) {
      logger.error(`Error getting thread messages: ${error.message}`);
      logger.error(error.stack);
      return [];
    }
  }
  
  /**
   * Builds context for the LLM for a specific thread
   * @param {string} threadTs - Thread timestamp
   * @param {Object} options - Build options
   * @returns {Array} - Messages array for LLM
   */
  buildLLMContext(threadTs, options = {}) {
    try {
      // Simply delegate to the new formatted context builder
      logger.info(`buildLLMContext: Delegating to new buildFormattedLLMContext for thread ${threadTs}`);
      return this.buildFormattedLLMContext(threadTs, options);
    } catch (error) {
      logger.error('Error in buildLLMContext:', error);
      return [];
    }
  }
  
  /**
   * Enhances a context object with thread information if missing
   * @param {Object} context - Context object to enhance
   * @returns {Object} - Enhanced context (or original if already complete)
   */
  enhanceWithThreadInfo(context) {
    // Create a shallow copy to avoid direct modification
    const enhancedContext = { ...context };
    
    // If we have a threadId but no thread messages, add them
    if (enhancedContext.threadId && !enhancedContext.messages) {
      const threadMessages = this.getFormattedThreadMessages(enhancedContext.threadId);
      if (threadMessages && threadMessages.length > 0) {
        enhancedContext.messages = threadMessages;
      }
    }
    
    // If we have a threadId but no channel, try to find it
    if (enhancedContext.threadId && !enhancedContext.channelId) {
      const channelId = this.getChannel(enhancedContext.threadId);
      if (channelId) {
        enhancedContext.channelId = channelId;
      }
    }
    
    return enhancedContext;
  }
  
  /**
   * Enhances a context object with user information if missing
   * @param {Object} context - Context object to enhance
   * @returns {Promise<Object>} - Enhanced context with user information
   */
  async enhanceWithUserInfo(context) {
    // Create a shallow copy to avoid direct modification
    const enhancedContext = { ...context };
    
    // If we have userId but no user object, fetch user info
    if (enhancedContext.userId && !enhancedContext.user) {
      try {
        // Get Slack client
        const { getSlackClient } = require('./slackClient');
        const slackClient = getSlackClient();
        
        // Fetch user info
        const userResponse = await slackClient.users.info({ user: enhancedContext.userId });
        if (userResponse.ok && userResponse.user) {
          enhancedContext.user = {
            id: userResponse.user.id,
            name: userResponse.user.name,
            real_name: userResponse.user.real_name,
            profile: userResponse.user.profile
          };
        }
      } catch (error) {
        // Log but don't fail if user info can't be retrieved
        logger.warn(`Could not fetch user info for ${enhancedContext.userId}:`, error.message);
      }
    }
    
    return enhancedContext;
  }

  /**
   * Force the creation of a minimal context from user input when normal context building fails
   * @param {string} threadId - The thread ID
   * @param {Object} userContext - User context from Slack
   * @returns {Array} - A minimal context array
   */
  buildEmergencyContext(threadId, userContext) {
    try {
      logger.info(`🚨 Building emergency context for thread ${threadId}`);
      
      // Array to hold our emergency context
      const emergencyContext = [];
      
      // Add system message explaining the situation
      emergencyContext.push({
        role: 'system',
        content: 'EMERGENCY CONTEXT: The normal context building process failed. This is a reconstructed minimal context.',
        timestamp: new Date().toISOString()
      });
      
      // Add the user's latest message
      if (userContext && userContext.text) {
        emergencyContext.push({
          role: 'user',
          content: {
            text: userContext.text,
            userid: userContext.userId || 'unknown'
          },
          timestamp: new Date().toISOString()
        });
        
        logger.info(`Added user message to emergency context: ${userContext.text}`);
      } else {
        // No user context available, add a generic user message
        emergencyContext.push({
          role: 'user',
          content: {
            text: 'Can you help me?',
            userid: 'unknown'
          },
          timestamp: new Date().toISOString()
        });
        
        logger.info('Added generic user message to emergency context');
      }
      
      // Add another system message with guidance for the LLM
      emergencyContext.push({
        role: 'system',
        content: 'Please respond to the user\'s message as best you can with the limited context. After responding, call finishRequest to complete the interaction.',
        timestamp: new Date().toISOString()
      });
      
      logger.info(`Built emergency context with ${emergencyContext.length} items`);
      
      return emergencyContext;
    } catch (error) {
      logger.error(`Error building emergency context: ${error.message}`);
      
      // Absolute last resort - return a minimal context with just an error message
      return [
        {
          role: 'system',
          content: 'CRITICAL ERROR: Context building completely failed. Please respond to the user and call finishRequest.'
        },
        {
          role: 'user',
          content: {
            text: 'Can you help me?',
            userid: 'unknown'
          }
        }
      ];
    }
  }
}

// Singleton instance
let contextBuilderInstance = null;

/**
 * Gets the singleton instance of ContextBuilder
 * @returns {ContextBuilder} The context builder instance
 */
function getContextBuilder() {
  if (!contextBuilderInstance) {
    contextBuilderInstance = new ContextBuilder();
  }
  return contextBuilderInstance;
}

module.exports = {
  ContextBuilder,
  getContextBuilder,
  MessageTypes,
  MessageSources,
  validateContext
}; 