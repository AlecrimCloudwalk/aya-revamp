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
    this.messages = new Map(); // Message ID -> ContextMessage
    this.threadMessages = new Map(); // ThreadTS -> Array of Message IDs
    this.threadMetadata = new Map(); // ThreadTS -> Map of metadata
    this.toolResults = new Map(); // ThreadTS -> Map of tool results
    this.buttonStates = new Map(); // ThreadTS -> Map of button states 
    this.debug = process.env.DEBUG_CONTEXT === 'true';
  }
  
  /**
   * Add a message to the context
   * @param {Object} message - Message data
   * @returns {string} - ID of the added message
   */
  addMessage(message) {
    try {
      // Process into standardized format
      const contextMessage = this._processMessage(message);
      
      // Skip if no valid ID
      if (!contextMessage || !contextMessage.id) {
        logger.warn('Skipping message with no valid ID:', message);
        return null;
      }
      
      // Store in messages map
      this.messages.set(contextMessage.id, contextMessage);
      
      // Add to thread index
      if (contextMessage.threadTs) {
        if (!this.threadMessages.has(contextMessage.threadTs)) {
          this.threadMessages.set(contextMessage.threadTs, []);
        }
        
        const threadMsgs = this.threadMessages.get(contextMessage.threadTs);
        if (!threadMsgs.includes(contextMessage.id)) {
          threadMsgs.push(contextMessage.id);
        }
      }
      
      if (this.debug) {
        logger.info(`Added message to context: ${contextMessage.id} (${contextMessage.type})`);
      }
      
      return contextMessage.id;
    } catch (error) {
      logError('Error adding message to context', error, { message });
      return null;
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
   * Records the execution of a tool
   * @param {string} threadTs - Thread timestamp
   * @param {string} toolName - Name of the tool
   * @param {Object} args - Arguments used
   * @param {Object} result - Result of the execution
   * @param {Error} error - Error if execution failed
   */
  recordToolExecution(threadTs, toolName, args, result, error = null) {
    try {
      // Create a unique key for this execution
      const executionKey = `${toolName}-${JSON.stringify(args)}`;
      
      // Get or create the tool results map for this thread
      if (!this.toolResults.has(threadTs)) {
        this.toolResults.set(threadTs, new Map());
      }
      
      const threadToolResults = this.toolResults.get(threadTs);
      
      // Record the execution
      const executionRecord = {
        result,
        timestamp: new Date().toISOString(),
        error: error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : null
      };
      
      threadToolResults.set(executionKey, executionRecord);
      
      // If this was a message post, add timestamp to messages
      if (toolName === 'postMessage' && result?.ts) {
        // Add a special note in metadata about this timestamp
        this.setMetadata(threadTs, 'sentMessages', 
          [...(this.getMetadata(threadTs, 'sentMessages') || []), result.ts]
        );
      }
      
      // If this was a button creation, track it
      if (toolName === 'createButtonMessage' && result?.actionId) {
        this.setButtonState(threadTs, result.actionId, 'active', result.metadata);
      }
      
      logger.info(`Recorded tool execution: ${toolName} in thread ${threadTs}`);
      return true;
    } catch (error) {
      logger.error(`Error recording tool execution: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Check if a tool has been executed with specific args
   * @param {string} threadTs - Thread timestamp
   * @param {string} toolName - Name of the tool
   * @param {Object} args - Arguments to check
   * @returns {boolean} - Whether tool has been executed
   */
  hasExecuted(threadTs, toolName, args) {
    try {
      if (!this.toolResults.has(threadTs)) return false;
      
      const executionKey = `${toolName}-${JSON.stringify(args)}`;
      return this.toolResults.get(threadTs).has(executionKey);
    } catch (error) {
      logger.error(`Error checking if tool was executed: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Get the result of a tool execution
   * @param {string} threadTs - Thread timestamp
   * @param {string} toolName - Name of the tool
   * @param {Object} args - Arguments used
   * @returns {Object} - Result of the execution
   */
  getToolResult(threadTs, toolName, args) {
    try {
      if (!this.toolResults.has(threadTs)) return null;
      
      const executionKey = `${toolName}-${JSON.stringify(args)}`;
      const executionRecord = this.toolResults.get(threadTs).get(executionKey);
      
      if (!executionRecord) return null;
      
      return executionRecord.result;
    } catch (error) {
      logger.error(`Error getting tool result: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Gets history of tool executions for a thread
   * @param {string} threadTs - Thread timestamp
   * @param {number} limit - Maximum number of executions to return
   * @returns {Array} - Array of execution records
   */
  getToolExecutionHistory(threadTs, limit = 10) {
    try {
      if (!this.toolResults.has(threadTs)) return [];
      
      const threadToolResults = this.toolResults.get(threadTs);
      
      // Convert the Map entries to an array and sort by timestamp (newest first)
      const executionEntries = Array.from(threadToolResults.entries())
        .map(([key, record]) => {
          // Parse the key to get toolName and args
          const keyParts = key.split('-');
          const toolName = keyParts[0];
          let args = {};
          
          try {
            // Try to parse the args part of the key
            const argsJson = key.substring(toolName.length + 1);
            args = JSON.parse(argsJson);
          } catch (e) {
            // If parsing fails, just use the raw string
            args = { raw: key.substring(toolName.length + 1) };
          }
          
          return {
            toolName,
            args,
            ...record,
            key
          };
        })
        .sort((a, b) => {
          // Sort by timestamp, newest first
          return new Date(b.timestamp) - new Date(a.timestamp);
        })
        .slice(0, limit); // Limit the number of entries
        
      return executionEntries;
    } catch (error) {
      logger.error(`Error getting tool execution history: ${error.message}`);
      return [];
    }
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
   * Builds context for the LLM for a specific thread
   * @param {string} threadTs - Thread timestamp
   * @param {Object} options - Build options
   * @returns {Array} - Messages array for LLM
   */
  buildLLMContext(threadTs, options = {}) {
    try {
      const { limit = 25, includeBotMessages = true } = options;
      
      // Log what we're doing
      logger.info(`Building LLM context for thread ${threadTs} with options:`, options);
      
      // Make sure threadTs exists
      if (!threadTs || !this.threadMessages.has(threadTs)) {
        logger.warn(`No messages found for thread ${threadTs}`);
        return [];
      }
      
      // Get messages for this thread
      const threadMsgs = this.threadMessages.get(threadTs) || [];
      
      // Debug log
      logger.info(`Found ${threadMsgs.length} messages for thread ${threadTs}`);
      
      // Get the most recent messages (up to limit)
      const latestFirst = [...threadMsgs].reverse();
      const limitedMsgIds = latestFirst.slice(0, limit);
      
      // Track button clicks to avoid duplicates
      const buttonClicks = new Set();
      
      // Transform into LLM-compatible message format
      const messages = [];
      
      // Track user/assistant message order for proper threading
      let lastRole = null;
      let lastTime = null;
      
      // Process each message
      for (const msgId of limitedMsgIds) {
        const msg = this.messages.get(msgId);
        if (!msg) continue;
        
        // Skip bot messages if specified
        if (!includeBotMessages && msg.source === MessageSources.ASSISTANT) {
          continue;
        }
        
        // Determine message role
        let role = 'user';
        if (msg.source === MessageSources.ASSISTANT) {
          role = 'assistant';
        } else if (msg.source === MessageSources.SYSTEM) {
          role = 'system';
        }
        
        // Button click handling - deduplicate and convert to system message
        if (msg.type === MessageTypes.BUTTON_CLICK || msg.source === 'button_click' || 
            (msg.type === 'button_selection' || msg.metadata?.type === 'button_selection')) {
          // Get key information
          const buttonText = msg.metadata?.buttonText || 'Unknown button';
          const buttonValue = msg.metadata?.buttonValue || 'unknown';
          const buttonKey = `${buttonText}:${buttonValue}`;
          
          // Skip if we've already processed this button
          if (buttonClicks.has(buttonKey)) {
            logger.info(`Skipping duplicate button click: ${buttonKey}`);
            continue;
          }
          
          // Mark as processed
          buttonClicks.add(buttonKey);
          
          // Add a clear system message
          messages.push({
            role: 'system',
            content: `The user clicked the "${buttonText}" button with value "${buttonValue}". The original message has already been updated to show this selection. Respond with the next logical step based on this selection.`,
            name: 'button_click_info'
          });
          
          continue; // Skip further processing for button clicks
        }
        
        // Skip empty or obviously corrupted messages
        if (!msg.text || typeof msg.text !== 'string' || msg.text.trim() === '') {
          logger.info(`Skipping empty message: ${msgId}`);
          continue;
        }
        
        // Get content
        const content = msg.text || '';
        
        // Check if this message continues the previous one (same role)
        if (lastRole === role && role !== 'system') {
          // If timestamps are close (within 5 seconds), combine the messages
          const lastTimeMs = lastTime ? new Date(lastTime).getTime() : 0;
          const currentTimeMs = new Date(msg.timestamp).getTime();
          
          if (Math.abs(currentTimeMs - lastTimeMs) < 5000 && messages.length > 0) {
            // Append to previous message
            const lastMsg = messages[messages.length - 1];
            lastMsg.content = `${lastMsg.content}\n\n${content}`;
            logger.info(`Combined with previous message (${role})`);
            continue;
          }
        }
        
        // Standard case - add as new message
        const message = { role, content };
        
        // Add name for system messages, helps with identification
        if (role === 'system' && msg.metadata?.type) {
          message.name = msg.metadata.type;
        }
        
        messages.push(message);
        
        // Update tracking
        lastRole = role;
        lastTime = msg.timestamp;
      }
      
      // Add a warning if we have no messages
      if (messages.length === 0) {
        logger.warn(`No valid messages found for thread ${threadTs}`);
        messages.push({
          role: 'system',
          content: 'No message history found. This appears to be a new conversation.',
          name: 'no_history_warning'
        });
      }
      
      // Log what we're returning
      logger.info(`Returning ${messages.length} messages for LLM context`);
      
      // Return in earliest-first order (required for LLM)
      return messages.reverse();
    } catch (error) {
      logger.error('Error building LLM context:', error);
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