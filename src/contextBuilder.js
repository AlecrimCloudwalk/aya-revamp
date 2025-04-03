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
   * @returns {string} - Generated tool execution ID
   */
  recordToolExecution(threadId, toolName, args, result, error = null) {
    try {
      // Check if thread exists
      if (!this.toolExecutions.has(threadId)) {
        this.toolExecutions.set(threadId, []);
      }
      
      // Generate execution ID
      const executionId = `tool_${toolName}_${Date.now()}`;
      
      // Assign a sequence number to this tool execution
      const sequence = this.getNextSequence(threadId);
      
      // Create execution record
      const executionRecord = {
        id: executionId,
        toolName,
        threadId,
        timestamp: new Date().toISOString(),
        args: { ...args },  // Clone to avoid reference issues
        result: result ? { ...result } : null,  // Clone if exists
        error: error ? error.message : null,
        sequence: sequence, // Store the sequence number
        reasoning: args.reasoning || null, // Capture the reasoning
      };
      
      // Add to list
      this.toolExecutions.get(threadId).unshift(executionRecord);
      
      // For postMessage tool, associate it with the message sequence
      if (toolName === 'postMessage' && result && result.ts) {
        const messageId = `bot_${result.ts}`;
        this.messageSequences.set(messageId, sequence);
        this.toolToMessageMap.set(executionId, messageId);
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
   * Builds context for the LLM for a specific thread
   * @param {string} threadTs - Thread timestamp
   * @param {Object} options - Build options
   * @returns {Array} - Messages array for LLM
   */
  buildLLMContext(threadTs, options = {}) {
    try {
      const { limit = 25, includeBotMessages = true, includeToolCalls = true } = options;
      
      // Log what we're doing
      logger.info(`Building LLM context for thread ${threadTs} with options:`, options);
      
      // Make sure threadTs exists
      if (!threadTs || !this.threadMessages.has(threadTs)) {
        logger.warn(`No messages found for thread ${threadTs}`);
        return [];
      }
      
      // Get messages for this thread
      const threadMsgs = this.threadMessages.get(threadTs) || [];
      
      // Get tool executions for this thread
      const toolExecs = this.toolExecutions.get(threadTs) || [];
      
      // Debug log
      logger.info(`Found ${threadMsgs.length} messages and ${toolExecs.length} tool executions for thread ${threadTs}`);
      
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
      
      // Sort by sequence first, then by timestamp
      allItems.sort((a, b) => {
        if (a.sequence !== b.sequence) {
          return b.sequence - a.sequence; // Descending sequence
        }
        // If same sequence, sort by timestamp
        return new Date(b.timestamp) - new Date(a.timestamp);
      });
      
      // Limit to most recent items
      const limitedItems = allItems.slice(0, limit * 2); // Double limit to include tool calls
      
      // Group by sequence number
      const groupedBySequence = {};
      for (const item of limitedItems) {
        if (!groupedBySequence[item.sequence]) {
          groupedBySequence[item.sequence] = [];
        }
        groupedBySequence[item.sequence].push(item);
      }
      
      // Create LLM-compatible format messages
      const messages = [];
      
      // Process sequence groups in reverse order (newest first)
      const sequences = Object.keys(groupedBySequence)
        .map(Number)
        .sort((a, b) => b - a);
      
      // Take only a limited number of sequence groups
      const limitedSequences = sequences.slice(0, limit);
      
      for (const sequence of limitedSequences) {
        const items = groupedBySequence[sequence];
        
        // Skip empty sequences
        if (!items || items.length === 0) continue;
        
        // Find the message in this sequence group
        const messageItems = items.filter(item => item.type === 'message');
        
        // Skip if no message and not including tool calls
        if (messageItems.length === 0 && !includeToolCalls) continue;
        
        // Find the tools in this sequence group
        const toolItems = items.filter(item => item.type === 'tool');
        
        // Process messages
        for (const msgItem of messageItems) {
          const message = msgItem.item;
          
          // Skip bot messages if not including them
          if ((message.source === 'assistant' || message.source === 'llm') && !includeBotMessages) {
            continue;
          }
          
          let content = '';
          
          // Add sequence prefix
          content += `[${sequence}] `;
          
          // Add tools if available for this sequence
          if (toolItems.length > 0 && includeToolCalls) {
            // Only include tools for assistant messages
            if (message.source === 'assistant' || message.source === 'llm') {
              for (const toolItem of toolItems) {
                const tool = toolItem.item;
                content += `tool: ${tool.toolName} (`;
                
                // Add simplified args
                const args = tool.args || {};
                const argsList = [];
                for (const [key, value] of Object.entries(args)) {
                  if (key !== 'reasoning' && key !== 'threadContext') {
                    if (typeof value === 'string' && value.length > 30) {
                      argsList.push(`${key}: "${value.substring(0, 30)}..."`);
                    } else {
                      argsList.push(`${key}: ${JSON.stringify(value)}`);
                    }
                  }
                }
                content += argsList.join(', ');
                content += ')\n';
              }
            }
          }
          
          // Add message content with source prefix
          if (message.source === 'user') {
            content += `user: ${message.text || ''}`;
          } else if (message.source === 'assistant' || message.source === 'llm') {
            content += `assistant: ${message.text || ''}`;
          } else if (message.source === 'system') {
            content += `system: ${message.text || ''}`;
          }
          
          // Add reasoning if available
          for (const toolItem of toolItems) {
            const tool = toolItem.item;
            if (tool.reasoning) {
              content += `\n[${sequence}] reasoning: ${tool.reasoning}`;
              break; // Only add reasoning once
            }
          }
          
          // Add to messages array
          if (message.source === 'user') {
            messages.push({
              role: 'user',
              content: content,
              name: `user_${Date.now().toString()}`
            });
          } else if (message.source === 'assistant' || message.source === 'llm') {
            messages.push({
              role: 'assistant',
              content: content,
              name: `assistant_${Date.now().toString()}`
            });
          } else if (message.source === 'system') {
            messages.push({
              role: 'system',
              content: content,
              name: `system_${Date.now().toString()}`
            });
          }
        }
        
        // If no messages but there are tools, add as system message
        if (messageItems.length === 0 && toolItems.length > 0 && includeToolCalls) {
          let content = `[${sequence}] `;
          
          for (const toolItem of toolItems) {
            const tool = toolItem.item;
            content += `Tool executed: ${tool.toolName}\n`;
            content += `Args: ${JSON.stringify(tool.args || {}, null, 2)}\n`;
            if (tool.reasoning) {
              content += `Reasoning: ${tool.reasoning}\n`;
            }
            if (tool.error) {
              content += `Error: ${tool.error}\n`;
            }
          }
          
          messages.push({
            role: 'system',
            content: content,
            name: `system_tool_${Date.now().toString()}`
          });
        }
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
      
      // Look for a matching execution
      return executions.some(exec => {
        // Must match the tool name
        if (exec.toolName !== toolName) return false;
        
        // Check if args match approximately (simplified check)
        if (!args || Object.keys(args).length === 0) {
          return true; // No args to check, just match on tool name
        }
        
        // Simple key matching (not perfect but workable for compatibility)
        return Object.keys(args).every(key => {
          return exec.args && exec.args[key] !== undefined;
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