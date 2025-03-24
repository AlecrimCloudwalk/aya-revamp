// Orchestrates the flow between Slack, LLM, and tools
const { getNextAction } = require('./llmInterface.js');
const { getTool, isAsyncTool } = require('./tools/index.js');
const { logError } = require('./errors.js');
const { getSlackClient } = require('./slackClient.js');

// In-memory store for active threads (in a production app, use a database)
const activeThreads = new Map();
// In-memory store for async operations
const asyncOperations = new Map();

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
    
    // Do not send an error message - let the LLM handle all user communication
  }
}

/**
 * Processes a thread with the LLM
 * 
 * @param {Object} threadState - Current thread state
 * @returns {Promise<void>}
 */
async function processThread(threadState) {
  // Exit early if no context or thread state
  if (!threadState || !threadState.context) {
    console.log("No thread state or context provided, cannot process");
    return false;
  }
  
  console.log("🔍 THREAD STATE ANALYSIS:");
  console.log("- Thread has processed:", threadState.iterations, "iterations");
  console.log("- Thread has finishRequest toolResult:", 
              threadState.toolResults.some(r => r.toolName === "finishRequest") ? "Yes" : "No");
  console.log("- Thread has message count:", threadState.userMessages.length + threadState.botMessages.length);
  
  // Maximum number of iterations to prevent infinite loops
  const MAX_ITERATIONS = 10;
  let iteration = 0;
  let lastResponse = null;
  let hasPostedMessage = false;
  let shouldAutoFinish = false;  // Initialize the flag for auto-finishing
  
  // Create a request ID for this processing loop
  const requestId = Date.now().toString();
  
  console.log("\n🔄 THREAD:", threadState.context.threadTs || "DIRECT_MESSAGE");
  console.log("🔍 REQUEST ID:", requestId);
  console.log("--------------------------------");
  
  // Track this processing session's iterations
  threadState.iterations = threadState.iterations || 0;
  
  // Initialize the sentContentMessages array if it doesn't exist
  if (!threadState.sentContentMessages) {
    threadState.sentContentMessages = [];
  }
  
  while (iteration < MAX_ITERATIONS) {
    // Track iterations to catch potential loops
    iteration++;
    threadState.iterations++;
    console.log(`- Iteration ${iteration}/${MAX_ITERATIONS} (Thread total: ${threadState.iterations})`);
    
    try {
      // Call LLM to get the next action
      const llmResult = await getNextAction(threadState);
      
      // Get the tool calls from the LLM response
      const { toolCalls, content } = llmResult;
      
      // If no tool calls were found, log a warning and try one more time
      if (!toolCalls || toolCalls.length === 0) {
        console.log("⚠️ No tool calls found in LLM response, requesting again");
        
        if (iteration >= MAX_ITERATIONS - 1) {
          console.log("❌ Max iterations reached without valid tool calls, aborting");
          break;
        }
        
        continue; // Try again in the next iteration
      }
      
      // Process the first tool call (we only support one at a time)
      const toolCall = toolCalls[0];
      console.log(`📣 Processing tool call: ${toolCall.tool}`);
      
      // Execute the tool
      const toolResult = await executeToolAction({
        toolName: toolCall.tool,
        toolArgs: toolCall.parameters,
        toolCallId: toolCall.id
      }, threadState, requestId);
      
      // Add the result to the thread state
      addToolResultToThread(threadState, toolResult);
      
      // Handle specific tool behaviors
      if (toolCall.tool === 'postMessage') {
        hasPostedMessage = true;
        
        // Add the message text to the list of sent messages
        if (toolCall.parameters.text && !threadState.sentContentMessages.includes(toolCall.parameters.text)) {
          threadState.sentContentMessages.push(toolCall.parameters.text);
        }
      } 
      else if (toolCall.tool === 'finishRequest') {
        // If finishRequest is called, we're done with this thread
        console.log("📢 finishRequest called - ending processing loop");
        break;
      }
      
      // After processing a postMessage and there's no finishRequest, 
      // auto-finish on the last iteration
      if (hasPostedMessage && iteration >= MAX_ITERATIONS - 1 && 
          !threadState.toolResults.some(r => r.toolName === 'finishRequest' && r.requestId === requestId)) {
        shouldAutoFinish = true;
      }
    } catch (error) {
      console.log(`\n❌ ERROR DURING ITERATION ${iteration}: ${error.message}`);
      console.log("--------------------------------");
      
      logError(`Error during iteration ${iteration}`, error, { threadState });
      
      // If we've already posted a message, auto-finish to avoid leaving the thread hanging
      if (hasPostedMessage) {
        shouldAutoFinish = true;
      }
      
      // Break the loop on error unless we need to auto-finish
      if (!shouldAutoFinish) {
        break;
      }
    }
    
    // Auto-finish if we've posted a message but not called finishRequest
    if (shouldAutoFinish && hasPostedMessage && 
        !threadState.toolResults.some(r => r.toolName === 'finishRequest' && r.requestId === requestId)) {
      console.log("🔄 Auto-finishing request after postMessage");
      
      try {
        // Execute the finishRequest tool with a generic summary
        const finishResult = await executeToolAction({
          toolName: 'finishRequest',
          toolArgs: { 
            summary: "Request completed", 
            reasoning: "Auto-finish after postMessage" 
          },
          toolCallId: `auto_finish_${Date.now()}`
        }, threadState, requestId);
        
        // Add the result to the thread state
        addToolResultToThread(threadState, finishResult);
        
        // Break the loop as we're done
        break;
      } catch (error) {
        console.log(`- Error during auto-finish: ${error.message}`);
        logError('Error auto-finishing request', error);
        break;
      }
    }
  }
  
  console.log(`\n✅ THREAD COMPLETE - ${iteration} steps${shouldAutoFinish ? ' (auto-finish after postMessage)' : ''}`);
  console.log("--------------------------------");
  
  return true;
}

/**
 * Executes a tool based on LLM action
 * 
 * @param {Object} action - Action from LLM
 * @param {Object} threadState - Current thread state
 * @param {string} requestId - Request ID
 * @returns {Promise<Object>} - Result of the action
 */
async function executeToolAction(action, threadState, requestId) {
  const { toolName, toolArgs, toolCallId } = action;
  
  try {
    // Get the tool from the registry
    const toolFunction = getTool(toolName);
    const isAsync = isAsyncTool(toolName);
    
    // Add before executing any extracted tool - log first
    console.log("⚠️ TOOL EXECUTION PATH:");
    console.log("- Source:", toolArgs ? "Structured Tool Call" : "Content JSON");
    console.log("- Tool Name:", toolName);
    console.log("- Is duplicate of previous call:", isDuplicateToolCall(toolName, toolArgs, threadState));
    
    // Check for duplicate postMessage calls with similar content
    if (toolName === 'postMessage') {
      const isDuplicate = isDuplicateToolCall(toolName, toolArgs, threadState);
      
      if (isDuplicate) {
        console.log(`⛔ DUPLICATE TOOL CALL DETECTED - Skipping execution`);
        console.log(`- This exact ${toolName} has already been executed`);
        
        // Return a non-executed result to avoid duplicating the same message
        return { 
          toolName,
          args: toolArgs,
          response: { 
            ok: true, 
            duplicate: true,
            message: "Duplicate call detected - not executed"
          },
          toolCallId,
          timestamp: new Date().toISOString(),
          duplicate: true,
          requestId
        };
      }
      
      // If there have been multiple postMessage calls in this iteration, mark to end request
      const postMessagesThisIteration = threadState.toolResults
        .filter(r => r.toolName === 'postMessage' && r.requestId === requestId)
        .length;
        
      if (postMessagesThisIteration >= 1) {
        console.log(`⚠️ Multiple postMessage calls in one iteration (${postMessagesThisIteration + 1}) - will auto-finish after this one`);
      }
    }
    
    // Special handling for postMessage to prevent duplicate messages during button clicks
    if (toolName === 'postMessage' && threadState.buttonClickState && threadState.buttonClickState.processing) {
      // Check if we already posted a message for this button click
      if (threadState.buttonClickState.messagePosted) {
        console.log(`⚠️ Already sent a message for this button click. Enabling auto-finish.`);
        
        // If trying to post a second message, automatically finish the request
        if (toolName !== 'finishRequest') {
          const finishTool = getTool('finishRequest');
          await finishTool({ summary: "Request completed" }, threadState);
          console.log(`- Automatically executing finishRequest after postMessage`);
          return { 
            toolName,
            args: toolArgs,
            response: { 
              ok: true, 
              autoFinished: true,
              message: "Auto-finished after duplicate postMessage"
            },
            toolCallId,
            timestamp: new Date().toISOString(),
            autoFinished: true,
            requestId
          };
        }
      }
      
      // Mark that we've posted a message for this button click
      if (toolName === 'postMessage') {
        threadState.buttonClickState.messagePosted = true;
      }
    }
    
    // Handle async tools differently
    if (isAsync) {
      console.log(`Tool "${toolName}" is asynchronous - scheduling async execution`);
      
      // Register the async operation
      const operationId = `${threadState.context.threadTs || 'dm'}-${requestId}-${toolName}-${Date.now()}`;
      
      // Return an immediate response that the operation has been scheduled
      const initialResponse = {
        status: "scheduled",
        message: `Operation ${operationId} has been scheduled for async execution`,
        operationId
      };
      
      // Schedule the async operation to execute in the background
      executeAsyncOperation(
        operationId,
        toolFunction,
        toolArgs,
        threadState,
        toolName,
        toolCallId
      );
      
      return { 
        toolName,
        args: toolArgs,
        response: initialResponse,
        toolCallId,
        timestamp: new Date().toISOString(),
        isAsync: true,
        operationId,
        requestId
      };
    }
    
    // For synchronous tools, proceed normally
    console.log(`- Tool: ${toolName}`);
    const startTime = Date.now();
    const toolResponse = await toolFunction(toolArgs, threadState);
    const duration = Date.now() - startTime;
    
    // For postMessage tool, add the message content to the thread messages
    // so the LLM can see its own previous responses
    if (toolName === 'postMessage' && toolArgs) {
      // Track the message text in sentContentMessages to prevent duplicates
      if (toolArgs.text && !threadState.sentContentMessages.includes(toolArgs.text)) {
        threadState.sentContentMessages.push(toolArgs.text);
      }
      
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
      requestId
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
        message: error.message,
        stack: error.stack?.split('\n').slice(0, 3).join('\n') || 'No stack trace available',
        toolName: toolName,
        actionFailed: true,
        errorTime: new Date().toISOString()
      },
      toolCallId,
      timestamp: new Date().toISOString(),
      requestId
    };
  }
}

/**
 * Executes a tool asynchronously and updates thread state when complete
 * @param {string} operationId - Unique ID for the async operation
 * @param {Function} toolFunction - The tool function to execute
 * @param {Object} toolArgs - Arguments for the tool
 * @param {Object} threadState - Thread state
 * @param {string} toolName - Name of the tool
 * @param {string} toolCallId - ID of the tool call
 */
async function executeAsyncOperation(
  operationId,
  toolFunction,
  toolArgs,
  threadState,
  toolName,
  toolCallId
) {
  // Register the operation as in progress
  asyncOperations.set(operationId, {
    status: "in_progress",
    startTime: Date.now(),
    threadId: threadState.context.threadTs || 'dm',
    channelId: threadState.context.channelId,
    userId: threadState.context.userId,
    toolName,
    toolArgs
  });
  
  try {
    console.log(`Starting async operation ${operationId}`);
    
    // Execute the tool
    const startTime = Date.now();
    const toolResponse = await toolFunction(toolArgs, threadState);
    const duration = Date.now() - startTime;
    
    // Update the operation status
    asyncOperations.set(operationId, {
      ...asyncOperations.get(operationId),
      status: "completed",
      completionTime: Date.now(),
      response: toolResponse,
      error: null
    });
    
    console.log(`Async operation ${operationId} completed in ${duration}ms`);
    
    // Create a standardized tool result
    const toolResult = {
      toolName,
      args: toolArgs,
      response: toolResponse,
      toolCallId,
      timestamp: new Date().toISOString(),
      duration,
      isAsync: true,
      operationId,
      status: "completed"
    };
    
    // Get the current thread state (it may have changed)
    const currentThreadState = activeThreads.get(threadState.context.threadTs || 'dm');
    
    if (currentThreadState) {
      // Add the result to the thread state
      addToolResultToThread(currentThreadState, toolResult);
      
      console.log(`Async operation ${operationId} completed successfully in ${duration}ms`);
      
      // Optionally continue processing the thread
      // await processThread(currentThreadState);
    }
    
    return toolResult;
  } catch (error) {
    console.log(`Error in async operation ${operationId}: ${error.message}`);
    
    // Update the operation status
    asyncOperations.set(operationId, {
      ...asyncOperations.get(operationId),
      status: "failed",
      completionTime: Date.now(),
      error: error.message
    });
    
    console.log(`Async operation ${operationId} failed: ${error.message}`);
    logError(`Error in async operation ${operationId}`, error, { threadState, toolName });
    
    return {
      toolName,
      args: toolArgs,
      error: true,
      response: {
        error: true,
        message: error.message
      },
      toolCallId,
      timestamp: new Date().toISOString(),
      isAsync: true,
      operationId,
      status: "failed"
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
    userMessages: [],  // Add this to avoid undefined errors
    botMessages: [],   // Add this to avoid undefined errors
    toolResults: [],
    processedButtonClicks: [],
    iterations: 0      // Initialize iterations counter
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
  
  // Ensure userMessages and botMessages arrays exist
  if (!threadState.userMessages) threadState.userMessages = [];
  if (!threadState.botMessages) threadState.botMessages = [];
  
  // Add to the appropriate category array
  if (message.isUser) {
    threadState.userMessages.push(messageWithTimestamp);
  } else {
    threadState.botMessages.push(messageWithTimestamp);
  }
  
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

/**
 * Handles interactive button clicks from Slack
 * 
 * @param {Object} context - Button click context
 * @returns {Promise<void>}
 */
async function handleButtonClick(context) {
  try {
    console.log("\n👆 BUTTON CLICK");
    console.log(`User: ${context.userId} | Channel: ${context.channelId} | Action: ${context.actionId}`);
    console.log(`Value: ${context.actionValue}`);
    if (context.threadTs) console.log(`Thread: ${context.threadTs}`);
    console.log("--------------------------------");
    
    // Get the thread state or initialize a new one
    const threadState = getThreadState(context);
    
    // Check if this exact button click was already processed (deduplication)
    const buttonSignature = `${context.actionId}-${context.actionValue}-${context.messageTs}`;
    if (threadState.processedButtonClicks && threadState.processedButtonClicks.includes(buttonSignature)) {
      console.log(`Button click ${buttonSignature} already processed, skipping`);
      return;
    }
    
    // Initialize or update processed button clicks tracking
    if (!threadState.processedButtonClicks) {
      threadState.processedButtonClicks = [];
    }
    threadState.processedButtonClicks.push(buttonSignature);
    
    // If button has metadata with callbackId, use it to look up button registry
    let buttonInfo = null;
    let buttonText = context.actionValue;
    let buttonContext = '';
    let callbackId = null;
    
    if (context.metadata && context.metadata.callbackId) {
      callbackId = context.metadata.callbackId;
      const buttonRegistry = threadState.buttonRegistry || {};
      
      if (buttonRegistry[callbackId]) {
        buttonInfo = buttonRegistry[callbackId];
        console.log(`Found registered button set for callback: ${callbackId}`);
        
        // Find the specific button that was clicked to get its full context
        if (buttonInfo.buttons && Array.isArray(buttonInfo.buttons)) {
          const clickedButton = buttonInfo.buttons.find(b => b.value === context.actionValue);
          if (clickedButton) {
            buttonText = clickedButton.text || buttonText;
          }
        }
        
        // Add the original message context if available
        if (context.originalMessage) {
          buttonContext = `The button was clicked on a message that said: "${extractFullMessageContent(context.originalMessage)}"`;
        }
      }
    }
    
    // Create a request ID specific to this button click
    const buttonClickRequestId = `button_click_${Date.now()}`;
    
    // Add the button click to the thread as a specialized message type
    addMessageToThread(threadState, {
      text: `[BUTTON CLICK] User clicked the button: "${buttonText}"${buttonContext ? `\n\nContext: ${buttonContext}` : ''}`,
      isUser: true,
      timestamp: new Date().toISOString(),
      userId: context.userId,
      isButtonClick: true,
      buttonClickId: buttonSignature,
      requestId: buttonClickRequestId,
      buttonInfo: {
        actionId: context.actionId,
        value: context.actionValue,
        text: buttonText,
        metadata: context.metadata,
        originalMessageTs: context.messageTs
      }
    });
    
    // Update the original button message to show the selection
    try {
      // Get the updateButtonMessage tool
      const updateButtonMessageTool = getTool('updateButtonMessage');
      
      // Update the button message
      await updateButtonMessageTool({
        messageTs: context.messageTs,
        selectedValue: context.actionValue,
        callbackId: callbackId,
        additionalText: `\n\n_Button selected by <@${context.userId}>_`
      }, threadState);
      
      console.log(`- Updated original button message to reflect selection`);
    } catch (error) {
      console.log(`- Error updating button message: ${error.message}`);
      logError('Error updating button message', error, { context });
    }
    
    // Add a flag to prevent duplicate message responses
    threadState.buttonClickState = {
      processing: true,
      buttonSignature,
      messagePosted: false,
      timestamp: new Date().toISOString(),
      requestId: buttonClickRequestId
    };
    
    // Update the thread state with a flag indicating we're processing a button click
    threadState.context.currentButtonClick = {
      buttonSignature,
      timestamp: new Date().toISOString(),
      requestId: buttonClickRequestId
    };
    
    // Process the thread to generate a response
    await processThread(threadState);
    
    // Clear the current button click from context after processing
    delete threadState.context.currentButtonClick;
    if (threadState.buttonClickState) {
      delete threadState.buttonClickState;
    }
  } catch (error) {
    logError('Error handling button click', error, { context });
  }
}

// Helper function to check for duplicate tool calls
function isDuplicateToolCall(toolName, args, threadState) {
  // If there are no tool results yet, it can't be a duplicate
  if (!threadState.toolResults || threadState.toolResults.length === 0) {
    return false;
  }
  
  // For postMessage tools, we want to be more careful about duplicates
  if (toolName === 'postMessage') {
    // First try an exact argument match
    const exactMatch = threadState.toolResults.some(result => 
      result.toolName === toolName && 
      JSON.stringify(result.args) === JSON.stringify(args)
    );
    
    if (exactMatch) {
      return true;
    }
    
    // If no exact match, check for similar content (text field matches)
    if (args && args.text) {
      return threadState.toolResults.some(result => {
        // Must be a postMessage tool
        if (result.toolName !== 'postMessage') return false;
        
        // If the result has no args, skip
        if (!result.args) return false;
        
        // Check if text fields match
        const resultText = result.args.text || '';
        const newText = args.text || '';
        
        // If both are empty, not a match
        if (!resultText && !newText) return false;
        
        // Check for exact text match
        if (resultText === newText) return true;
        
        // Check if one is substring of the other (for partial matches)
        if (resultText.includes(newText) || newText.includes(resultText)) {
          console.log(`⚠️ Text similarity detected between messages - "${resultText.substring(0, 30)}..." and "${newText.substring(0, 30)}..."`);
          return true;
        }
        
        return false;
      });
    }
    
    return false;
  }
  
  // For other tools, just check for exact argument match
  return threadState.toolResults.some(result => {
    // Special case for finishRequest with autoFinish flag - these should never be considered duplicates
    if (toolName === 'finishRequest' && args && args.autoFinish) {
      return false;
    }
    
    return result.toolName === toolName && 
           JSON.stringify(result.args) === JSON.stringify(args);
  });
}

module.exports = {
  handleIncomingSlackMessage,
  handleButtonClick
}; 