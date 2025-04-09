/**
 * ContextBuilder - A unified system for building and managing context for the LLM
 * 
 * This module handles the standardization of messages from various sources
 * (Slack API, LLM responses, button clicks, etc.) into a consistent format 
 * that can be used to build context for the LLM. It also manages thread-specific
 * state like tool executions, button states, and metadata.
 */

const { logError } = require('./errors.js');
const logger = require('./toolUtils/logger.js');
const { formatTimestamp, formatRelativeTime, formatContextTimestamp } = require('./toolUtils/dateUtils.js');
const { calculateTextSimilarity } = require('./toolUtils/messageFormatUtils');


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
   * Records a tool execution in the context
   * @param {string} threadId - Thread ID
   * @param {string} toolName - Name of the tool
   * @param {Object} args - Tool arguments
   * @param {Object} result - Tool execution result
   * @param {Error} [error] - Error object if the tool execution failed
   * @param {boolean} [skipped] - Whether the tool execution was skipped
   * @returns {string} - Generated tool execution ID
   */
  recordToolExecution(threadId, toolName, args, result, error = null, skipped = false) {
    try {
      // Check if thread exists
      if (!this.toolExecutions.has(threadId)) {
        this.toolExecutions.set(threadId, []);
      }
      
      // Generate execution ID
      const executionId = `tool_${toolName}_${Date.now()}`;
      
      // Assign a sequence number to this tool execution
      const sequence = this.getNextSequence(threadId);
      
      // Get current date and time for logging
      const timestamp = new Date();
      const isoTimestamp = timestamp.toISOString();
      
      // Format timestamps with error handling
      let formattedTime = 'unknown time';
      let relativeTime = 'just now';
      
      try {
        formattedTime = formatTimestamp(timestamp);
        relativeTime = 'just now'; // New executions are always "just now"
      } catch (timeError) {
        logger.warn(`Error formatting timestamp in recordToolExecution: ${timeError.message}`);
      }
      
      // Determine the turn ID based on the sequence counter
      const turnId = Math.floor(sequence / 2) + 1;
      
      // Format status - prioritize skipped over error
      let status;
      if (skipped) {
        status = "SKIPPED";
      } else if (error) {
        status = "ERROR";
      } else {
        status = "SUCCESS";
      }
      
      // For getThreadHistory results, create a simplified version to prevent bloating logs
      let processedResult = result;
      if (toolName === 'getThreadHistory' && result) {
        // Only keep summary information, not full message content
        processedResult = {
          messagesRetrieved: result.messagesRetrieved,
          threadTs: result.threadTs,
          channelId: result.channelId,
          threadStats: result.threadStats,
          indexInfo: result.indexInfo,
          contextRebuilt: result.contextRebuilt,
          // Remove the large sections that bloat logs
          messagesCount: result.messages ? result.messages.length : 0
        };
      } else {
        // Make a safe clone of the result to avoid reference issues
        processedResult = result ? JSON.parse(JSON.stringify(result)) : null;
      }
      
      // Create execution record
      const executionRecord = {
        id: executionId,
        toolName,
        threadId,
        timestamp: isoTimestamp,
        formattedTime,
        relativeTime,
        turnId,
        args: { ...args },  // Clone to avoid reference issues
        result: processedResult,
        error: error ? error.message : null,
        skipped: skipped,
        status,
        sequence: sequence, // Store the sequence number
        reasoning: args.reasoning || null, // Capture the reasoning
      };
      
      // Add to list
      this.toolExecutions.get(threadId).unshift(executionRecord);
      
      // Log standardized execution record for LLM context
      try {
        const logEntry = `[${turnId}] tool ${toolName} called, ${status.toLowerCase()} at ${formattedTime}`;
        logger.info(logEntry);
      } catch (logError) {
        logger.warn(`Error logging tool execution: ${logError.message}`);
      }
      
      // For postMessage tool, associate it with the message sequence and log the message
      if (toolName === 'postMessage' && result && result.ts) {
        const messageId = `bot_${result.ts}`;
        this.messageSequences.set(messageId, sequence);
        this.toolToMessageMap.set(executionId, messageId);
        
        // Log message content preview (truncated if long) with error handling
        try {
          const messageText = args.text || '';
          const previewText = messageText.length > 50 ? 
            `${messageText.substring(0, 50)}...` : 
            messageText;
          logger.info(`[${turnId}] assistant: ${previewText}`);
          
          // Log reasoning if available
          if (args.reasoning) {
            logger.info(`[${turnId}] reasoning: "${args.reasoning}"`);
          }
          
          // Add system guidance for the LLM about next steps
          logger.info(`[system] Message was successfully posted at ${formattedTime}. Decide if you want to call finishRequest to complete this user interaction.`);
        } catch (msgLogError) {
          logger.warn(`Error logging message preview: ${msgLogError.message}`);
        }
      }
      
      // Trim if too many
      if (this.toolExecutions.get(threadId).length > 100) {
        this.toolExecutions.get(threadId).pop();
      }
      
      return executionId;
    } catch (error) {
      logger.error(`Error recording tool execution: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Add a message to the context
   * @param {Object} message - Message object
   * @returns {boolean} - Whether the message was added successfully
   */
  addMessage(message) {
    try {
      // Validate message has required fields
      if (!message || !message.threadTs) {
        logger.warn('Attempted to add invalid message to context');
        return false;
      }
      
      // Generate ID if none provided
      const messageId = message.id || `msg_${Date.now()}`;
      
      // Get thread timestamp
      const threadTs = message.threadTs;
      
      // Initialize thread if not exists
      if (!this.threadMessages.has(threadTs)) {
        this.threadMessages.set(threadTs, []);
      }
      
      // Assign a sequence number to this message if not from a tool call
      let sequence;
      if (message.source === 'user') {
        // User messages get their own sequence
        sequence = this.getNextSequence(threadTs);
      } else if (message.fromToolExecution) {
        // If message came from a tool execution, use that sequence
        sequence = message.sequence;
      } else {
        // All other messages get their own sequence if not specified
        sequence = message.sequence || this.getNextSequence(threadTs);
      }
      
      // Store the sequence with this message
      this.messageSequences.set(messageId, sequence);
      
      // Store message with ID
      const fullMessage = {
        ...message,
        id: messageId,
        timestamp: message.timestamp || new Date().toISOString(),
        sequence: sequence
      };
      
      this.messages.set(messageId, fullMessage);
      
      // Add to thread
      const threadMessages = this.threadMessages.get(threadTs);
      if (!threadMessages.includes(messageId)) {
        threadMessages.push(messageId);
      }
      
      return true;
    } catch (error) {
      logger.error(`Error adding message to context: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Process message into standardized format
   * @param {Object} message - Raw message data
   * @returns {Object} - Standardized context message
   */
  _processMessage(message) {
    // Basic validation
    if (!message) return null;
    
    // Different handling based on source
    if (message.source === 'slack') {
      return this._processSlackMessage(message);
    } else if (message.source === 'llm') {
      return this._processLLMMessage(message);
    } else if (message.source === 'button_click') {
      return this._processButtonClick(message);
    } else if (message.source === 'system') {
      return this._processSystemMessage(message);
    } else {
      // Generic processing for other message types
      return {
        id: message.id || `msg_${Date.now()}`,
        timestamp: message.timestamp || new Date().toISOString(),
        threadTs: message.threadTs,
        source: message.source || MessageSources.SYSTEM,
        sourceId: message.sourceId,
        originalContent: message.originalContent || message,
        text: message.text || 'No text content',
        type: message.type || MessageTypes.TEXT,
        metadata: message.metadata || {}
      };
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
   * Format a message for LLM consumption
   * @param {Object} message - Message to format
   * @param {number} index - Index in the context sequence
   * @returns {Object|null} - Formatted message object or null if invalid
   */
  _formatMessageForLLM(message, index) {
    if (!message) return null;
    
    const formattedTime = formatContextTimestamp(message.timestamp);
    let formattedString = '';
    let role = 'system';
    let source = message.source;
    
    if (message.source === 'user') {
      // Format: [1] DD/MM/YYYY HH:mm - USER <@userID>: message
      const userId = this._extractUserId(message);
      formattedString = `[${index}] ${formattedTime} - USER <@${userId}>: ${message.text || ''}`;
      role = 'user';
    } else if (message.source === 'assistant' || message.source === 'llm') {
      // Format: [2] DD/MM/YYYY HH:mm - BOT MESSAGE: message
      formattedString = `[${index}] ${formattedTime} - BOT MESSAGE: ${message.text || ''}`;
      role = 'assistant';
    } else if (message.source === 'system') {
      // Format: [3] DD/MM/YYYY HH:mm - BOT SYSTEM: message
      formattedString = `[${index}] ${formattedTime} - BOT SYSTEM: ${message.text || ''}`;
      role = 'system';
    } else {
      // Unknown source, skip
      return null;
    }
    
    return {
      role,
      source,
      formattedString,
      raw: message.text || ''
    };
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
   * Builds context for the LLM using the new standardized format specified in docs/llm_context_format.md
   * @param {string} threadTs - Thread timestamp
   * @param {Object} options - Build options
   * @returns {Array} - Messages array for LLM in the new format
   */
  buildFormattedLLMContext(threadTs, options = {}) {
    try {
      const { limit = 25, includeBotMessages = true, includeToolCalls = true, skipLogging = false } = options;
      
      // Only log if not explicitly skipped (helps prevent duplicate logs)
      if (!skipLogging) {
        logger.info(`Building formatted LLM context for thread ${threadTs}`);
      }
      
      // Make sure threadTs exists
      if (!threadTs || !this.threadMessages.has(threadTs)) {
        logger.warn(`No messages found for thread ${threadTs}`);
        return [];
      }
      
      // Get messages for this thread
      const threadMsgs = this.threadMessages.get(threadTs) || [];
      
      // Get tool executions for this thread
      const toolExecs = this.toolExecutions.get(threadTs) || [];
      
      // Get thread metadata for user info
      const metadata = this.getMetadata(threadTs) || {};
      const context = metadata.context || {};
      const iterations = metadata.iterations || 0;
      
      // Extract user information
      const userInfo = context.user || {};
      const userId = this._extractUserId(this.messages.get(threadMsgs[0]));
      const userTimezone = userInfo.timezone || 'America/Sao_Paulo';
      const isDirectMessage = context.isDirectMessage || false;
      const channel = context.channelName || (isDirectMessage ? 'Direct Message' : 'Unknown Channel');
      
      // Debug log - only if not skipped
      if (!skipLogging) {
        logger.info(`Found ${threadMsgs.length} messages and ${toolExecs.length} tool executions for thread ${threadTs}`);
      }
      
      // Create an array of all items (messages and tool executions) with their sequence numbers
      const allItems = [];
      
      // Add messages
      for (const msgId of threadMsgs) {
        if (!this.messages.has(msgId)) continue;
        
        const message = this.messages.get(msgId);
        const sequence = this.messageSequences.get(msgId) || 0;
        
        allItems.push({
          type: 'message',
          item: message,
          sequence: sequence,
          timestamp: message.timestamp
        });
      }
      
      // Add tool executions if enabled
      if (includeToolCalls) {
        for (const tool of toolExecs) {
          allItems.push({
            type: 'tool',
            item: tool,
            sequence: tool.sequence || 0,
            timestamp: tool.timestamp
          });
        }
      }
      
      // Sort by timestamp in chronological order (oldest first)
      allItems.sort((a, b) => {
        return new Date(a.timestamp) - new Date(b.timestamp);
      });
      
      // Create an array to hold the JSON context entries
      const jsonContext = [];

      // Count different message types for conversation stats
      const userMessages = allItems.filter(item => 
        item.type === 'message' && item.item.source === 'user'
      );
      const botMessages = allItems.filter(item => 
        item.type === 'message' && 
        (item.item.source === 'assistant' || item.item.source === 'llm')
      );
      const totalMessages = threadMsgs.length;
      const toolCallsCount = toolExecs.length;
      const inThread = context.isThread || false;
      const threadHistoryCalls = toolExecs.filter(tool => tool.toolName === 'getThreadHistory').length;
      const isInitialMessage = totalMessages === 1;
      const mentionedUsers = context.mentionedUsers || [];
      const hasMentions = mentionedUsers.length > 0;
      
      // Create conversation stats object (added before the system prompt)
      const conversationStats = {
        index: 0,
        turn: 0,
        timestamp: new Date().toISOString(),
        role: "system",
        content: {
          type: "conversation_stats",
          stats: {
            channel_info: {
              channel: channel,
              is_dm: isDirectMessage,
              is_thread: inThread,
              is_initial_message: isInitialMessage,
              has_mentions: hasMentions,
              mentioned_users_count: mentionedUsers.length
            },
            message_counts: {
              total_messages: totalMessages,
              user_messages: userMessages.length,
              bot_messages: botMessages.length,
              available_messages: Math.min(totalMessages, limit)
            },
            tool_usage: {
              total_tool_calls: toolCallsCount,
              thread_history_calls: threadHistoryCalls
            }
          },
          guidance: "Use this information to decide whether to call getThreadHistory. In DMs or threads with only 1 message, extra context retrieval isn't needed."
        }
      };
      
      // Add conversation stats as the very first item
      jsonContext.push(conversationStats);

      // Add system message as the next entry with enhanced user info
      const ayaPrompts = require('./prompts/aya.js');
      const systemPrompt = ayaPrompts.generatePersonalityPrompt(userId, channel, iterations);

      // Add system message to our JSON context array
      jsonContext.push({
        index: 1,
        turn: 0,
        timestamp: new Date().toISOString(),
        role: "system",
        content: systemPrompt
      });
      
      // Group items by conversation turn for proper numbering
      // Initialize with turn 0 for the initial system message
      let currentTurn = 0;
      let lastUserMessageTime = null;
      let currentIndex = 2; // Start from 2 since we have stats and system message
      
      // Process all items according to turn-based numbering
      for (const item of allItems) {
        // Determine if this starts a new turn
        // A turn starts when a user message follows a bot message or tool call
        if (item.type === 'message' && 
          item.item.source === 'user' &&
          lastUserMessageTime !== null && 
          new Date(item.timestamp) - new Date(lastUserMessageTime) > 100) {
          currentTurn++;
        }
        
        // Remember last user message time
        if (item.type === 'message' && item.item.source === 'user') {
          lastUserMessageTime = item.timestamp;
        }
        
        // Format this item based on its type
        if (item.type === 'message') {
          // Format user or assistant messages
          const formattedMessage = this._formatMessageForLLM(item.item, currentIndex);
          
          if (formattedMessage) {
            // Generate content object with additional metadata
            const contentObj = {};
            
            // Add relevant message metadata
            if (item.item.text) {
              contentObj.text = item.item.text;
            }
            
            // Extract and add message identifiers for use in reactions
            const messageId = item.item.id || null;
            const messageTs = item.item.ts || (item.item.originalContent?.ts || null);
            
            // Add message identifiers to allow targeting for emoji reactions
            contentObj.message_id = messageId;
            
            // Add message timestamps for Slack API operations
            if (messageTs) {
              contentObj.message_ts = messageTs;
              
              // Mark this as the preferred identifier for API operations
              contentObj.api_identifier = messageTs;
            }
            
            // Include the channel ID if available for API operations
            const channelId = item.item.channelId || 
                            item.item.metadata?.channel || 
                            this.getChannel(threadTs);
            if (channelId) {
              contentObj.channel_id = channelId;
            }
            
            // Add additional metadata if available in the original message
            if (item.item.metadata) {
              // Add message index if available
              if (item.item.metadata.messageIndex !== undefined) {
                contentObj.message_index = item.item.metadata.messageIndex;
              }
              
              // Add parent message flag
              if (item.item.metadata.isParent) {
                contentObj.is_parent = true;
              }
              
              // Add thread timestamp
              if (item.item.metadata.threadTs) {
                contentObj.thread_ts = item.item.metadata.threadTs;
              }
            }
            
            // Add reactions if available in the message metadata
            if (item.item.metadata && item.item.metadata.reactions) {
              contentObj.reactions = item.item.metadata.reactions;
              
              // Add formatted reactions string if available
              if (item.item.metadata.formattedReactions) {
                contentObj.formatted_reactions = item.item.metadata.formattedReactions;
              }
            }
            
            // Add JSON context entry with proper role, turn number, and timestamp
            jsonContext.push({
              index: currentIndex,
              turn: currentTurn,
              timestamp: item.timestamp,
              role: formattedMessage.role,
              content: contentObj
            });
            
            currentIndex++;
          }
        } else if (item.type === 'tool' && includeToolCalls) {
          // Format tool executions
          const formattedTool = this._formatToolExecutionForLLM(item.item, currentIndex);
          
          if (formattedTool) {
            // Create a JSON structure for the tool call
            jsonContext.push({
              index: currentIndex,
              turn: currentTurn,
              timestamp: item.timestamp,
              role: formattedTool.role,
              content: {
                type: "tool_call",
                tool_name: item.item.toolName,
                status: item.item.error ? "error" : (item.item.skipped ? "skipped" : "success"),
                args: item.item.args || {},
                result: item.item.result || null,
                error: item.item.error || null
              }
            });
            
            currentIndex++;
          }
        }
      }
      
      // Return the fully formatted JSON context
      return jsonContext;
    } catch (error) {
      logError('Error building LLM context', error, { threadTs });
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
   * Get messages for a specific thread
   * @param {string} threadTs - Thread timestamp
   * @returns {Array} Array of messages
   */
  getThreadMessages(threadTs) {
    try {
      // If not a valid thread TS, return empty array
      if (!threadTs || !this.threadMessages.has(threadTs)) {
        return [];
      }
      
      // Get message IDs for this thread
      const messageIds = this.threadMessages.get(threadTs);
      if (!messageIds || !Array.isArray(messageIds)) {
        return [];
      }
      
      // Get actual messages from IDs
      return messageIds
        .map(id => this.messages.get(id))
        .filter(message => !!message); // Filter out any null/undefined messages
    } catch (error) {
      logger.error(`Error getting thread messages: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Check if a tool has been executed with specific args
   * @param {string} threadId - Thread ID
   * @param {string} toolName - Name of the tool
   * @param {Object} args - Arguments to check
   * @returns {boolean} - Whether tool has been executed
   */
  hasExecuted(threadId, toolName, args = {}) {
    try {
      // Check if thread exists in tool executions
      if (!this.toolExecutions.has(threadId)) {
        return false;
      }
      
      // Get tool executions for this thread
      const executions = this.toolExecutions.get(threadId);
      
      // Special handling for postMessage to avoid treating different messages as duplicates
      if (toolName === 'postMessage' && args.text) {
        return executions.some(exec => {
          // Must match the tool name
          if (exec.toolName !== toolName) return false;
          
          // If no args in previous execution, it can't be a match
          if (!exec.args || !exec.args.text) return false;
          
          // For postMessage, compare text content with similarity detection
          const similarity = calculateTextSimilarity(args.text, exec.args.text);
          
          // Lower the similarity threshold from 0.95 to 0.85
          // This allows more variation between messages while still catching true duplicates
          return similarity > 0.85;
        });
      }
      
      // For other tools, do a more precise comparison of args
      return executions.some(exec => {
        // Must match the tool name
        if (exec.toolName !== toolName) return false;
        
        // Check if args match (more detailed check)
        if (!args || Object.keys(args).length === 0) {
          return true; // No args to check, just match on tool name
        }
        
        // Compare all keys and values
        return Object.keys(args).every(key => {
          // Skip reasoning check - reasoning can be different
          if (key === 'reasoning') return true;
          
          // Compare the values
          return exec.args && 
                 exec.args[key] !== undefined && 
                 JSON.stringify(exec.args[key]) === JSON.stringify(args[key]);
        });
      });
    } catch (error) {
      logger.error(`Error checking if tool was executed: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Get the result of a tool execution
   * @param {string} threadId - Thread ID
   * @param {string} toolName - Name of the tool
   * @param {Object} args - Arguments used
   * @returns {Object} - Result of the execution
   */
  getToolResult(threadId, toolName, args = {}) {
    try {
      // Check if thread exists in tool executions
      if (!this.toolExecutions.has(threadId)) {
        return null;
      }
      
      // Get tool executions for this thread
      const executions = this.toolExecutions.get(threadId);
      
      // Find a matching execution
      const matchingExec = executions.find(exec => {
        // Must match the tool name
        if (exec.toolName !== toolName) return false;
        
        // Check if args match approximately
        if (!args || Object.keys(args).length === 0) {
          return true; // No args to check, just match on tool name
        }
        
        // Simple key matching
        return Object.keys(args).every(key => {
          return exec.args && exec.args[key] !== undefined;
        });
      });
      
      // Return the result if found
      return matchingExec ? matchingExec.result : null;
    } catch (error) {
      logger.error(`Error getting tool result: ${error.message}`);
      return null;
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
  MessageSources
}; 