// Orchestrates the flow between Slack, LLM, and tools
const { getNextAction } = require('./llmInterface.js');
const tools = require('./tools/index.js');
const { logError } = require('./errors.js');
const { getSlackClient } = require('./slackClient.js');

// In-memory store for active threads (in a production app, use a database)
const activeThreads = new Map();

/**
 * Handles an incoming message from Slack
 * @param {Object} context - Message context from Slack
 * @returns {Promise<void>}
 */
async function handleIncomingSlackMessage(context) {
  try {
    console.log("\n📨 INCOMING MESSAGE");
    console.log(`User: ${context.userId} | Channel: ${context.channelId} | Type: ${context.isMention ? 'mention' : context.isCommand ? 'command' : 'message'}`);
    console.log(`Text: "${context.text}"`);
    if (context.threadTs) console.log(`Thread: ${context.threadTs}`);
    console.log("--------------------------------");
    
    // Add a thinking emoji reaction to let the user know we're processing
    try {
      const slackClient = getSlackClient();
      await slackClient.reactions.add({
        channel: context.channelId,
        timestamp: context.timestamp || context.threadTs,
        name: 'hourglass_flowing_sand'
      });
      console.log("- Added processing reaction to message");
    } catch (reactionError) {
      console.log(`- Failed to add reaction: ${reactionError.message}`);
    }
    
    // Get or initialize thread state
    const threadState = getThreadState(context);
    
    // If this is in a thread, get thread stats first
    if (context.threadTs) {
      await enrichWithThreadStats(threadState);
    }
    
    // Add the incoming message to the thread
    addMessageToThread(threadState, {
      text: context.text,
      isUser: true,
      timestamp: context.timestamp,
      userId: context.userId
    });
    
    // Start the processing loop
    await processThread(threadState);
    
    // When complete, replace the thinking emoji with a checkmark
    try {
      const slackClient = getSlackClient();
      
      // Remove the thinking emoji
      await slackClient.reactions.remove({
        channel: context.channelId,
        timestamp: context.timestamp || context.threadTs,
        name: 'hourglass_flowing_sand'
      });
      
      // Add a checkmark emoji
      await slackClient.reactions.add({
        channel: context.channelId,
        timestamp: context.timestamp || context.threadTs,
        name: 'white_check_mark'
      });
      
      console.log("- Updated reaction to indicate completion");
    } catch (reactionError) {
      console.log(`- Failed to update reaction: ${reactionError.message}`);
    }
  } catch (error) {
    console.log(`\n❌ ERROR HANDLING MESSAGE: ${error.message}`);
    console.log("--------------------------------");
    
    logError('Error handling incoming Slack message', error, { context });
    
    // Update reaction to show error
    try {
      const slackClient = getSlackClient();
      
      // Remove the thinking emoji if it exists
      try {
        await slackClient.reactions.remove({
          channel: context.channelId,
          timestamp: context.timestamp || context.threadTs,
          name: 'hourglass_flowing_sand'
        });
      } catch (removeError) {
        // Ignore errors when removing reaction (might not exist)
      }
      
      // Add error emoji
      await slackClient.reactions.add({
        channel: context.channelId,
        timestamp: context.timestamp || context.threadTs,
        name: 'x'
      });
    } catch (reactionError) {
      console.log(`- Failed to add error reaction: ${reactionError.message}`);
    }
    
    // Try to send an error message to Slack if possible
    try {
      const slackClient = getSlackClient();
      await slackClient.chat.postMessage({
        channel: context.channelId,
        text: `Error processing request: ${error.message}`,
        thread_ts: context.threadTs
      });
    } catch (slackError) {
      logError('Failed to send error message to Slack', slackError);
    }
  }
}

/**
 * Processes the thread through LLM-tool loops until complete
 * @param {Object} threadState - Current thread state
 * @returns {Promise<void>}
 */
async function processThread(threadState) {
  let isComplete = false;
  let maxIterations = 10; // Safety limit to prevent infinite loops
  let consecutiveErrors = 0; // Track consecutive errors
  let currentRequestId = Date.now().toString(); // Unique ID for this processing request
  let pendingFinishRequest = false; // Flag to indicate we need to call finishRequest
  
  console.log(`\n🔄 THREAD: ${threadState.id}`);
  console.log(`🔍 REQUEST ID: ${currentRequestId}`);
  console.log("--------------------------------");
  
  while (!isComplete && maxIterations > 0) {
    try {
      console.log(`- Iteration ${10 - maxIterations + 1}/${10}`);
      
      // If we have a pending finishRequest from a previous iteration,
      // manually create a finishRequest action
      if (pendingFinishRequest) {
        console.log(`- Automatically executing finishRequest after postMessage`);
        
        const toolResult = {
          toolName: 'finishRequest',
          args: { 
            reasoning: 'Automatically finishing request after postMessage',
            summary: 'Request completed' 
          },
          response: {
            complete: true,
            timestamp: new Date().toISOString(),
            summary: 'Request completed'
          },
          toolCallId: `auto_finish_${Date.now()}`,
          timestamp: new Date().toISOString(),
          requestId: currentRequestId
        };
        
        // Add the tool result to the thread state
        addToolResultToThread(threadState, toolResult);
        
        console.log(`\n✅ THREAD COMPLETE - ${10 - maxIterations + 1} steps (auto-finish)`);
        console.log(`🔄 Had postMessage: Yes (from previous step)`);
        console.log(`📝 Summary: Request completed`);
        console.log("--------------------------------");
        isComplete = true;
        
        // Clean up the thread state if needed
        cleanupThread(threadState);
        break;
      }
      
      // Get the next action from the LLM
      const action = await getNextAction(threadState);
      
      console.log(`- Tool: ${action.toolName}`);
      
      // Check if the response indicates we should follow up with finishRequest
      if (action.hasFinishRequest) {
        pendingFinishRequest = true;
        console.log(`- Will auto-execute finishRequest in next iteration`);
      }
      
      // Execute the specified tool
      const toolResult = await executeToolAction(action, threadState, currentRequestId);
      
      if (toolResult.error) {
        console.log(`- Error: ${toolResult.response.message}`);
      }
      
      // Add the tool result to the thread state
      addToolResultToThread(threadState, toolResult);
      
      // Reset consecutive error counter on success
      consecutiveErrors = 0;
      
      // Check if we're done with this request
      if (action.toolName === 'finishRequest') {
        // Check if there was a postMessage before this finishRequest
        const hasPostMessage = threadState.toolResults.some(
          result => result.toolName === 'postMessage' && result.requestId === currentRequestId
        );
        
        console.log(`\n✅ THREAD COMPLETE - ${10 - maxIterations + 1} steps`);
        console.log(`🔄 Had postMessage: ${hasPostMessage ? 'Yes' : 'No'}`);
        console.log(`📝 Summary: ${action.toolArgs.summary || 'No summary provided'}`);
        console.log("--------------------------------");
        isComplete = true;
        
        // Clean up the thread state if needed
        cleanupThread(threadState);
      }
      
      maxIterations--;
    } catch (error) {
      console.log(`\n❌ ERROR: ${error.message}`);
      
      logError('Error in thread processing loop', error, { 
        threadId: threadState.id 
      });
      
      // Increment consecutive error counter
      consecutiveErrors++;
      
      // Add the error to thread for context to the LLM
      addToolResultToThread(threadState, {
        toolName: 'error',
        args: {},
        response: {
          error: true,
          message: error.message
        }
      });
      
      // Break out of the loop after 2 consecutive errors to prevent spam
      if (consecutiveErrors >= 2) {
        console.log(`\n🛑 THREAD TERMINATED: Too many errors (${consecutiveErrors})`);
        console.log("--------------------------------");
        
        logError('Too many consecutive errors, stopping thread processing loop', null, {
          threadId: threadState.id,
          lastError: error.message
        });
        
        // Try to send an error message to the user
        try {
          const slackClient = getSlackClient();
          const { channelId, threadTs } = threadState.context;
          
          await slackClient.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: "I'm having trouble processing your request. Please try again later."
          });
        } catch (slackError) {
          logError('Failed to send error message to Slack', slackError);
        }
        
        isComplete = true;
      }
      
      // Try one more time after an error, but then exit
      if (maxIterations <= 1) {
        isComplete = true;
      }
    }
  }
  
  // If we reached max iterations, log it
  if (maxIterations <= 0 && !isComplete) {
    console.log(`\n⚠️ MAX ITERATIONS REACHED`);
    console.log("--------------------------------");
    
    logError('Reached maximum thread iterations', null, { 
      threadId: threadState.id 
    });
    
    // We've hit max iterations, but we don't force a finishRequest
    // because that would violate the LLM-driven principle
    // Instead, we just notify the user and let them start a new interaction
    try {
      const slackClient = getSlackClient();
      const { channelId, threadTs } = threadState.context;
      
      await slackClient.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: "I've been working on your request for a while but haven't been able to complete it. Please try with a new message."
      });
    } catch (slackError) {
      logError('Failed to send max iterations message to Slack', slackError);
    }
  }
}

/**
 * Executes a tool action
 * @param {Object} action - Tool action from LLM
 * @param {Object} threadState - Current thread state
 * @param {string} requestId - The ID of the current request
 * @returns {Promise<Object>} - Tool result
 */
async function executeToolAction(action, threadState, requestId) {
  const { toolName, toolArgs, toolCallId } = action;
  
  try {
    // Check if the tool exists
    if (!tools[toolName]) {
      throw new Error(`Tool "${toolName}" not found`);
    }
    
    // Call the tool with the arguments and thread context
    const startTime = Date.now();
    const toolResponse = await tools[toolName](toolArgs, threadState);
    const duration = Date.now() - startTime;
    
    // For postMessage tool, add the message content to the thread messages
    // so the LLM can see its own previous responses
    if (toolName === 'postMessage' && toolArgs) {
      // Construct a text message from the tool arguments
      let messageText = '';
      
      if (toolArgs.title) {
        messageText += `**${toolArgs.title}**\n\n`;
      }
      
      if (toolArgs.subtitle) {
        messageText += `*${toolArgs.subtitle}*\n\n`;
      }
      
      if (toolArgs.text) {
        messageText += toolArgs.text;
      }
      
      // Add fields if present
      if (toolArgs.fields && Array.isArray(toolArgs.fields)) {
        toolArgs.fields.forEach(field => {
          if (field.title && field.value) {
            messageText += `\n\n**${field.title}**: ${field.value}`;
          }
        });
      }
      
      // Add the message to the thread history
      if (messageText.trim()) {
        addMessageToThread(threadState, {
          text: messageText,
          isUser: false,
          timestamp: new Date().toISOString(),
          threadTs: threadState.context.threadTs,
          fromTool: true,
          requestId: requestId
        });
      }
    }
    
    // Return the standardized result
    return {
      toolName,
      args: toolArgs,
      response: toolResponse,
      toolCallId,
      timestamp: new Date().toISOString(),
      duration,
      requestId // Include the request ID with the tool result
    };
  } catch (error) {
    logError(`Error executing tool "${toolName}"`, error, { toolArgs });
    
    // Return the error as a result the LLM can handle
    return {
      toolName,
      args: toolArgs,
      error: true,
      response: {
        error: true,
        message: error.message
      },
      toolCallId,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Gets or initializes the thread state
 * @param {Object} context - Message context from Slack
 * @returns {Object} - The thread state
 */
function getThreadState(context) {
  // Create a unique thread ID (thread-based or DM-based)
  const threadId = context.threadTs || `${context.channelId}-${context.userId}`;
  
  // Check if we already have this thread in memory
  if (activeThreads.has(threadId)) {
    const existingThread = activeThreads.get(threadId);
    
    // If this is a thread but we have no messages, mark it as potentially needing history
    if (context.threadTs && existingThread.messages.length === 0) {
      existingThread.context.mayNeedHistory = true;
    }
    
    return existingThread;
  }
  
  // Initialize a new thread state
  const newThreadState = {
    id: threadId,
    context: {
      userId: context.userId,
      channelId: context.channelId,
      threadTs: context.threadTs,
      teamId: context.teamId,
      isCommand: !!context.isCommand,
      isMention: !!context.isMention,
      commandName: context.commandName,
      isDirectMessage: !context.threadTs && context.channelId.startsWith('D'),
      isThreadedConversation: !!context.threadTs,
      startTime: new Date().toISOString(),
      // If this is a thread that we haven't seen before, it may need history
      mayNeedHistory: !!context.threadTs
    },
    messages: [],
    toolResults: []
  };
  
  // Store in memory
  activeThreads.set(threadId, newThreadState);
  
  return newThreadState;
}

/**
 * Adds a message to the thread state
 * @param {Object} threadState - The thread state to update
 * @param {Object} message - The message to add {text, isUser, timestamp, userId, requestId}
 */
function addMessageToThread(threadState, message) {
  // Filter out dev mode prefix if present
  let processedText = message.text;
  if (typeof processedText === 'string') {
    // Use regex to remove !@# anywhere in the message
    if (processedText.includes('!@#')) {
      processedText = processedText.replace(/!@#/g, '').trim();
      console.log(`- Filtered dev mode marker from message`);
    }
  }
  
  // Ensure we have a valid timestamp for sorting later
  const messageWithTimestamp = {
    ...message,
    text: processedText,
    timestamp: message.timestamp || new Date().toISOString()
  };
  
  // Add the message to the thread
  threadState.messages.push(messageWithTimestamp);
  
  // Log the message
  console.log(`- Added ${message.isUser ? 'user' : 'bot'} message to thread${message.requestId ? ` (Request: ${message.requestId})` : ''}`);
}

/**
 * Adds a tool result to the thread state
 * @param {Object} threadState - The thread state to update
 * @param {Object} toolResult - The tool result to add
 */
function addToolResultToThread(threadState, toolResult) {
  // Ensure we have a valid timestamp for sorting later
  const toolResultWithTimestamp = {
    ...toolResult,
    timestamp: toolResult.timestamp || new Date().toISOString()
  };
  
  // Add the tool result to the thread
  threadState.toolResults.push(toolResultWithTimestamp);
  
  // Log the tool result
  console.log(`- Added tool result for ${toolResult.toolName} to thread`);
}

/**
 * Cleans up after a thread is complete
 * @param {Object} threadState - Current thread state
 */
function cleanupThread(threadState) {
  // In a real implementation with persistence, you might:
  // 1. Save the thread to a database
  // 2. Remove sensitive data
  // 3. Start a cleanup timer for removing old threads
  
  // For this example, just remove from memory after some time
  setTimeout(() => {
    activeThreads.delete(threadState.id);
  }, 30 * 60 * 1000); // Remove after 30 minutes
}

/**
 * Extract the full text content from a Slack message, including blocks
 * @param {Object} message - The Slack message object
 * @returns {string} - The extracted text content
 */
function extractFullMessageContent(message) {
  let content = message.text || '';
  
  // Check for blocks with rich text content
  if (message.blocks && Array.isArray(message.blocks)) {
    for (const block of message.blocks) {
      // Extract text from section blocks
      if (block.type === 'section') {
        // Text field
        if (block.text && block.text.text) {
          content += (content ? '\n\n' : '') + block.text.text;
        }
        
        // Fields array (key-value pairs)
        if (block.fields && Array.isArray(block.fields)) {
          for (const field of block.fields) {
            if (field.text) {
              content += (content ? '\n' : '') + field.text;
            }
          }
        }
      }
      
      // Extract text from header blocks
      if (block.type === 'header' && block.text && block.text.text) {
        content = block.text.text + (content ? '\n\n' + content : '');
      }
      
      // Extract text from rich_text_section blocks
      if (block.type === 'rich_text_section' && block.elements) {
        for (const element of block.elements) {
          if (element.type === 'text' && element.text) {
            content += element.text;
          }
        }
      }
    }
  }
  
  // Check for attachments (older message format)
  if (message.attachments && Array.isArray(message.attachments)) {
    for (const attachment of message.attachments) {
      // Add title if present
      if (attachment.title) {
        content += (content ? '\n\n' : '') + `**${attachment.title}**`;
      }
      
      // Add text if present
      if (attachment.text) {
        content += (content ? '\n' : '') + attachment.text;
      }
      
      // Add fields if present
      if (attachment.fields && Array.isArray(attachment.fields)) {
        for (const field of attachment.fields) {
          if (field.title && field.value) {
            content += (content ? '\n' : '') + `**${field.title}**: ${field.value}`;
          }
        }
      }
    }
  }
  
  return content.trim();
}

/**
 * Enriches the thread state with thread statistics and recent messages
 * @param {Object} threadState - Thread state to enrich
 * @returns {Promise<void>}
 */
async function enrichWithThreadStats(threadState) {
  const { channelId, threadTs } = threadState.context;
  
  if (!channelId || !threadTs) {
    console.log(`- No thread TS or channel ID, skipping thread enrichment`);
    return;
  }
  
  try {
    // Get the Slack client
    const slackClient = getSlackClient();
    
    // First, get thread info to know total messages and check if we have more than 10
    const threadInfoCheck = await slackClient.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 1, // Just to get the count
      inclusive: true
    });
    
    const totalMessages = threadInfoCheck.messages?.[0]?.reply_count || 0;
    
    // Now get the actual thread messages we want - oldest first
    // For long threads, get the first/oldest 10 including the parent message
    const threadInfo = await slackClient.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 10, // Get up to 10 messages - parent + 9 replies
      inclusive: true, // Include the parent message
      oldest: true // Ensure we get the oldest messages, not the most recent
    });
    
    // Store the thread statistics
    threadState.context.threadStats = {
      totalMessagesInThread: totalMessages,
      hasParentMessage: threadInfo.messages?.some(msg => msg.ts === threadTs) || false,
      lastChecked: new Date().toISOString()
    };
    
    console.log(`- Enriched with thread stats: ${threadState.context.threadStats.totalMessagesInThread} messages in thread`);
    
    // Skip message import if we already have multiple messages in the thread state
    const shouldSkipImport = threadState.messages.length > 1;
    if (shouldSkipImport) {
      console.log(`- Thread already has ${threadState.messages.length} messages, skipping message import`);
      return;
    }
    
    // Keep track of message timestamps we've already added to avoid duplicates
    const existingMessageTimestamps = new Set(
      threadState.messages.map(msg => msg.timestamp)
    );
    
    // Process and add recent messages to the thread state
    if (threadInfo.messages && threadInfo.messages.length > 0) {
      // Get bot user ID for distinguishing bot vs user messages
      let botUserId = null;
      try {
        const authInfo = await slackClient.auth.test();
        botUserId = authInfo.user_id;
      } catch (error) {
        console.log(`- Error getting bot user ID: ${error.message}`);
      }
      
      // Sort messages by timestamp (oldest first)
      const sortedMessages = [...threadInfo.messages].sort((a, b) => 
        parseFloat(a.ts) - parseFloat(b.ts)
      );
      
      // Process messages, adding position numbers
      for (let i = 0; i < sortedMessages.length; i++) {
        const message = sortedMessages[i];
        const messagePosition = i + 1;  // 1-based indexing for human readability
        
        // Get the full content of the message including blocks
        const fullMessageContent = extractFullMessageContent(message);
        
        // Skip messages without text
        if (!fullMessageContent) continue;
        
        // Skip if we've already added this message
        if (existingMessageTimestamps.has(message.ts)) {
          console.log(`- Skipping already added message with timestamp ${message.ts}`);
          continue;
        }
        
        // Determine if this is the parent message
        const isParent = message.ts === threadTs;
        
        // Determine if this is a bot message
        const isBot = message.bot_id || message.user === botUserId;
        
        // Add message to thread state
        addMessageToThread(threadState, {
          text: fullMessageContent,
          isUser: !isBot,
          timestamp: message.ts,
          userId: message.user || 'unknown',
          isParent,
          threadPosition: messagePosition  // Add position in thread
        });
        
        console.log(`- Imported ${isParent ? 'parent' : 'reply'} message #${messagePosition} from ${isBot ? 'bot' : 'user'}`);
      }
      
      console.log(`- Imported ${threadState.messages.length - existingMessageTimestamps.size} messages from thread history`);
    }
  } catch (error) {
    console.log(`- Error enriching thread: ${error.message}`);
    logError('Error enriching thread with stats', error, { threadState });
  }
}

module.exports = {
  handleIncomingSlackMessage
}; 