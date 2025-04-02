// Orchestrates the flow between Slack, LLM, and tools
const { getNextAction } = require('./llmInterface.js');
const tools = require('./tools/index.js');
const { getTool } = tools;
const { logError } = require('./errors.js');
const { getSlackClient } = require('./slackClient.js');
const { getContextBuilder } = require('./contextBuilder.js');
const { initializeContextIfNeeded } = require('./toolUtils/loadThreadHistory');
const { updateButtonMessage } = require('./buttonUpdater');

/**
 * Handles an incoming message from Slack
 */
async function handleIncomingSlackMessage(context) {
    try {
        console.log("\n📨 INCOMING MESSAGE");
        console.log(`User: ${context.userId} | Channel: ${context.channelId}`);
        console.log(`Text: "${context.text}"`);
        if (context.threadTs) console.log(`Thread: ${context.threadTs}`);
        console.log("--------------------------------");
        
        // Get thread ID (either thread timestamp or channel ID for direct messages)
        const threadId = context.threadTs || context.channelId;
        
        // Get context builder
        const contextBuilder = getContextBuilder();
        
        // Store context in the metadata
        contextBuilder.setMetadata(threadId, 'context', context);
        
        // Add context conversational info for easy access
        contextBuilder.setMetadata(threadId, 'conversationInfo', 
            `User:${context.userId}, Channel:${context.channelId}, Thread:${context.threadTs || 'N/A'}`
        );
        
        // Add message to context
        try {
            contextBuilder.addMessage({
                source: 'user',
                originalContent: {
                    text: context.text,
                    user: context.userId,
                    ts: context.timestamp,
                    thread_ts: context.threadTs,
                    channel: context.channelId
                },
                id: `user_${context.timestamp || Date.now()}`,
                timestamp: new Date().toISOString(),
                threadTs: context.threadTs || context.timestamp,
                text: context.text,
                sourceId: context.userId,
                metadata: {
                    channel: context.channelId,
                    isDirectMessage: context.isDirectMessage || false,
                    isMention: context.isMention || false
                }
            });
            
            console.log('Added incoming message to context builder');
        } catch (contextError) {
            console.error('Error adding message to context builder:', contextError);
        }
        
        // Add thinking reaction
        try {
            const slackClient = getSlackClient();
            await slackClient.reactions.add({
                channel: context.channelId,
                timestamp: context.timestamp || context.threadTs,
                name: 'loading'
            });
        } catch (reactionError) {
            console.log(`Failed to add reaction: ${reactionError.message}`);
        }
        
        // Process the thread
        await processThread(threadId);

        // Update reaction to checkmark
        try {
            const slackClient = getSlackClient();
            await slackClient.reactions.remove({
                channel: context.channelId,
                timestamp: context.timestamp || context.threadTs,
                name: 'loading'
            });
            await slackClient.reactions.add({
                channel: context.channelId,
                timestamp: context.timestamp || context.threadTs,
                name: 'white_check_mark'
            });
        } catch (reactionError) {
            console.log(`Failed to update reaction: ${reactionError.message}`);
        }

    } catch (error) {
        console.log(`\n❌ ERROR HANDLING MESSAGE: ${error.message}`);
        logError('Error handling incoming Slack message', error, { context });
        
        // Update reaction to error
        try {
            const slackClient = getSlackClient();
            await slackClient.reactions.remove({
                channel: context.channelId,
                timestamp: context.timestamp || context.threadTs,
                name: 'loading'
            });
            await slackClient.reactions.add({
                channel: context.channelId,
                timestamp: context.timestamp || context.threadTs,
                name: 'x'
            });
        } catch (reactionError) {
            console.log(`Failed to add error reaction: ${reactionError.message}`);
        }
    }
}

/**
 * Executes a tool and records its execution in thread state
 */
async function executeTool(toolName, args, threadId) {
    // Get context builder
    const contextBuilder = getContextBuilder();
    
    // Check if we've already executed this exact tool call
    if (contextBuilder.hasExecuted(threadId, toolName, args)) {
        console.log(`Tool ${toolName} already executed with these args, skipping`);
        return contextBuilder.getToolResult(threadId, toolName, args);
    }

    try {
        console.log(`📣 Executing tool: ${toolName}`);
        
        // STANDARDIZE: Handle reasoning parameter by moving it to the top level
        // We want reasoning to always be at the top level, not inside parameters
        let sanitizedArgs = { ...args };
        
        // Handle nested tool structure - this happens when the LLM returns 
        // { "tool": "toolName", "parameters": {...} } inside the parameters
        if (sanitizedArgs.tool && sanitizedArgs.parameters && sanitizedArgs.tool === toolName) {
            console.log('Detected nested tool structure, extracting inner parameters');
            sanitizedArgs = {
                ...sanitizedArgs.parameters,
                reasoning: sanitizedArgs.reasoning || sanitizedArgs.parameters.reasoning
            };
        }
        
        // Check if we have reasoning in both places
        if (sanitizedArgs.reasoning && 
            sanitizedArgs.parameters && 
            sanitizedArgs.parameters.reasoning) {
            // Keep only the top-level reasoning and remove the parameters.reasoning
            console.log('Detected duplicate reasoning fields - keeping only top-level reasoning');
            delete sanitizedArgs.parameters.reasoning;
        }
        
        // If reasoning is only in parameters, move it to the top level
        if (!sanitizedArgs.reasoning && 
            sanitizedArgs.parameters && 
            sanitizedArgs.parameters.reasoning) {
            sanitizedArgs.reasoning = sanitizedArgs.parameters.reasoning;
            delete sanitizedArgs.parameters.reasoning;
            console.log('Moved reasoning from parameters to top level for consistency');
        }
        
        console.log(`Parameters:`, JSON.stringify(sanitizedArgs, null, 2));
        
        const tool = getTool(toolName);
        if (!tool) {
            throw new Error(`Tool ${toolName} not found`);
        }
        
        // Pre-execution parameter validation and logging
        logParameterTypes(toolName, sanitizedArgs);

        // Create an object with thread-specific context for the tool
        const threadContext = {
            threadId: threadId,
            channelId: contextBuilder.getChannel(threadId),
            threadTs: contextBuilder.getThreadTs(threadId),
            getMetadata: (key) => contextBuilder.getMetadata(threadId, key),
            setMetadata: (key, value) => contextBuilder.setMetadata(threadId, key, value),
            getButtonState: (actionId) => contextBuilder.getButtonState(threadId, actionId),
            setButtonState: (actionId, state, metadata) => contextBuilder.setButtonState(threadId, actionId, state, metadata),
            addMessage: (message) => {
                message.threadTs = threadId;
                return contextBuilder.addMessage(message);
            },
            addToHistory: (message) => {
                message.threadTs = threadId;
                return contextBuilder.addMessage(message);
            }
        };

        // Pass the thread context object to the tool
        const result = await tool(sanitizedArgs, threadContext);
        
        // Record the tool execution in context builder
        contextBuilder.recordToolExecution(threadId, toolName, sanitizedArgs, result);
        
        return result;

    } catch (error) {
        console.log(`❌ Tool execution failed: ${error.message}`);
        // Add more detailed error information
        if (error.message.includes('JSON') || error.message.includes('array') || error.message.includes('object')) {
            console.log(`💡 This might be a parameter formatting issue. Check that arrays and objects are correctly formatted.`);
        }
        
        // Record the failed execution
        contextBuilder.recordToolExecution(threadId, toolName, args, null, error);
        
        throw error;
    }
}

/**
 * Log parameter types to help debug issues
 */
function logParameterTypes(toolName, args) {
    if (!args) {
        console.log(`⚠️ No parameters provided for ${toolName}`);
        return;
    }
    
    console.log(`Parameter types for ${toolName}:`);
    Object.entries(args).forEach(([key, value]) => {
        const type = typeof value;
        const isArray = Array.isArray(value);
        let additionalInfo = '';
        
        if (isArray) {
            additionalInfo = ` (array with ${value.length} items)`;
        } else if (type === 'object' && value !== null) {
            additionalInfo = ` (object with ${Object.keys(value).length} keys)`;
        } else if (type === 'string') {
            // Check if this might be a JSON string that should be parsed
            if ((value.startsWith('[') && value.endsWith(']')) || 
                (value.startsWith('{') && value.endsWith('}'))) {
                additionalInfo = ' ⚠️ Possible JSON string - might need parsing';
            }
            additionalInfo += ` (length: ${value.length})`;
        }
        
        console.log(`  - ${key}: ${isArray ? 'array' : type}${additionalInfo}`);
    });
}

/**
 * Processes a thread with the LLM
 */
async function processThread(threadId) {
    const MAX_ITERATIONS = 10;
    let iteration = 0;
    
    // Get context builder
    const contextBuilder = getContextBuilder();

    // Debug log: Print what context is stored
    const context = contextBuilder.getMetadata(threadId, 'context');
    
    console.log("\n--- THREAD CONTEXT ---");
    if (context) {
        console.log(`User ID: ${context.userId}`);
        console.log(`Channel: ${context.channelId}`);
        console.log(`Thread TS: ${context.threadTs}`);
        console.log(`User's message: "${context.text}"`);
        if (context.isButtonClick) {
            console.log(`Button click: ${context.buttonText} (value: ${context.actionValue})`);
        }
    } else {
        console.log(`No context in thread state`);
    }
    console.log("-----------------------");

    // Initialize the context builder with thread history if needed
    try {
        await initializeContextIfNeeded(threadId);
    } catch (contextError) {
        console.error('Error initializing context:', contextError);
        // Continue even if context initialization fails
    }

    // First, get the thread history to have better context for the LLM
    try {
        // Only fetch history if we're in a thread that exists
        if (context && context.threadTs) {
            console.log("Fetching thread history for context...");
            
            // Get history using the getThreadHistory tool
            const historyTool = getTool('getThreadHistory');
            if (historyTool) {
                const historyResult = await historyTool({
                    threadTs: context.threadTs,
                    limit: 10, // Get up to 10 messages
                    includeParent: true,
                    reasoning: "Getting thread history for better context"
                }, {
                    threadId: threadId,
                    threadTs: context.threadTs,
                    channelId: context.channelId,
                    addToHistory: (message) => {
                        message.threadTs = threadId;
                        return contextBuilder.addMessage(message);
                    }
                });
                
                console.log(`Retrieved ${historyResult.messagesRetrieved || 0} messages from thread history`);
                
                // Record the tool execution so the LLM knows about it
                contextBuilder.recordToolExecution(threadId, 'getThreadHistory', 
                    { threadTs: context.threadTs, limit: 10 }, 
                    historyResult);
            }
        }
    } catch (historyError) {
        console.log(`Failed to get thread history: ${historyError.message}`);
        // Continue even if history fetch fails
    }

    // Track if we've successfully processed the request
    let requestCompleted = false;
    let lastToolExecuted = null;
    let messagePosted = false;
    let messagesSent = 0;
    
    // Check if we're handling a button selection
    const isButtonSelection = context && context.isButtonClick === true;
    
    // Maximum message limit for button selections
    const MAX_BUTTON_MESSAGES = 1;
    // Maximum messages per user request (to prevent spam/duplicates)
    const MAX_MESSAGES_PER_REQUEST = 1;
    let buttonResponses = 0;
    
    // Keep track of recent message texts to detect duplicates
    const recentMessages = [];
    
    // Helper function to detect duplicate/similar messages
    function isSimilarToRecent(messageText) {
        if (!messageText) return false;
        
        for (const prevMessage of recentMessages) {
            // Simple similarity check - if the first 20 chars match, it's likely similar
            if (prevMessage.substring(0, 20) === messageText.substring(0, 20)) {
                console.log("⚠️ Detected similar message beginning, possible duplicate");
                return true;
            }
            
            // If messages are 80% the same length and have significant overlap, likely duplicate
            const lengthRatio = Math.min(prevMessage.length, messageText.length) / 
                               Math.max(prevMessage.length, messageText.length);
            
            if (lengthRatio > 0.8 && 
                (prevMessage.includes(messageText.substring(0, 30)) || 
                 messageText.includes(prevMessage.substring(0, 30)))) {
                console.log("⚠️ Detected significant message overlap, possible duplicate");
                return true;
            }
        }
        
        return false;
    }
    
    while (iteration < MAX_ITERATIONS && !requestCompleted) {
        iteration++;
        console.log(`\n🔄 Iteration ${iteration}/${MAX_ITERATIONS}`);

        try {
            // If we've already sent a message, strongly encourage finishing the request
            if (messagePosted && messagesSent >= MAX_MESSAGES_PER_REQUEST) {
                console.log(`Already sent ${messagesSent} messages - auto-finishing request`);
                
                // Auto-finish the request to prevent message spam
                const finishTool = getTool('finishRequest');
                if (finishTool) {
                    await finishTool({
                        summary: "Auto-completing request after sending message",
                        reasoning: "One message per user request is the standard behavior"
                    }, {
                        threadId: threadId,
                        threadTs: context?.threadTs,
                        channelId: context?.channelId,
                        addToHistory: (message) => {
                            message.threadTs = threadId;
                            return contextBuilder.addMessage(message);
                        }
                    });
                    
                    requestCompleted = true;
                    console.log("✅ Auto-completed request after message was sent");
                    break;
                }
            }

            // Get next action from LLM
            const llmResult = await getNextAction(threadId);
            
            // Check for tool calls
            const { toolCalls } = llmResult;
            if (!toolCalls?.length) {
                console.log("No tool calls found in LLM response");
                break;
            }

            // Execute the first tool call
            const { tool: toolName, parameters: args } = toolCalls[0];
            lastToolExecuted = toolName;
            
            // If tool is postMessage, check for duplicate content
            if (toolName === 'postMessage' && args?.text) {
                if (isSimilarToRecent(args.text)) {
                    console.log("⚠️ Skipping duplicate message content");
                    
                    // If we have a duplicate message but haven't finished the request,
                    // auto-finish it to prevent getting stuck in a loop
                    const finishTool = getTool('finishRequest');
                    if (finishTool) {
                        await finishTool({
                            summary: "Auto-completing after detecting duplicate content",
                            reasoning: "Prevented duplicate message"
                        }, {
                            threadId: threadId,
                            threadTs: context?.threadTs,
                            channelId: context?.channelId,
                            addToHistory: (message) => {
                                message.threadTs = threadId;
                                return contextBuilder.addMessage(message);
                            }
                        });
                        
                        requestCompleted = true;
                        console.log("✅ Auto-completed request to prevent duplicate messages");
                        break;
                    }
                    
                    // Skip to next iteration
                    continue;
                }
                
                // Store message to detect duplicates
                recentMessages.push(args.text);
            }
            
            // For button selections, limit number of messages 
            if (isButtonSelection && toolName === 'postMessage') {
                buttonResponses++;
                if (buttonResponses > MAX_BUTTON_MESSAGES) {
                    console.log(`Reached maximum messages (${MAX_BUTTON_MESSAGES}) for button selection - stopping iterations`);
                    requestCompleted = true;
                    
                    // Auto-finish the request
                    const finishTool = getTool('finishRequest');
                    if (finishTool) {
                        await finishTool({
                            summary: "Button selection completed after first response message",
                            reasoning: "Button selection was already visually acknowledged - stopping iterations after first message"
                        }, {
                            threadId: threadId,
                            threadTs: context.threadTs,
                            channelId: context.channelId,
                            addToHistory: (message) => {
                                message.threadTs = threadId;
                                return contextBuilder.addMessage(message);
                            }
                        });
                    }
                    
                    break;
                }
            }
            
            // Add proper thread context with working addToHistory
            const threadContext = {
                threadId: threadId,
                threadTs: context?.threadTs,
                channelId: context?.channelId,
                getMetadata: (key) => contextBuilder.getMetadata(threadId, key),
                setMetadata: (key, value) => contextBuilder.setMetadata(threadId, key, value),
                getButtonState: (actionId) => contextBuilder.getButtonState(threadId, actionId),
                setButtonState: (actionId, state, metadata) => 
                    contextBuilder.setButtonState(threadId, actionId, state, metadata),
                addMessage: (message) => {
                    message.threadTs = threadId;
                    return contextBuilder.addMessage(message);
                },
                addToHistory: (message) => {
                    message.threadTs = threadId;
                    return contextBuilder.addMessage(message);
                }
            };
            
            // Execute the tool
            const result = await executeTool(toolName, args, threadId);

            // If the tool was finishRequest, we're done
            if (toolName === 'finishRequest') {
                requestCompleted = true;
                console.log("Request finished with finishRequest tool");
                break;
            }
            
            // Track message posting
            if (toolName === 'postMessage' || toolName === 'createButtonMessage') {
                messagePosted = true;
                messagesSent++;
                
                // Add to context with metadata for proper tracking
                contextBuilder.addMessage({
                    source: 'assistant',
                    originalContent: {
                        tool: toolName,
                        parameters: args
                    },
                    id: `assistant_${result.ts || Date.now()}`,
                    timestamp: new Date().toISOString(),
                    threadTs: threadId,
                    text: args.text || "Message with no text content",
                    sourceId: 'assistant',
                    type: toolName === 'createButtonMessage' ? 'button_message' : 'text',
                    metadata: {
                        slackTs: result.ts,
                        toolName: toolName,
                        reasoning: args.reasoning || "No reasoning provided"
                    }
                });
                
                // For regular messages (not button clicks), auto-finish after the message
                // This is to prevent the problematic behavior of sending multiple messages
                if (!isButtonSelection && messagesSent >= MAX_MESSAGES_PER_REQUEST) {
                    console.log("Auto-finishing request after sending the first message");
                    
                    // Auto-finish the request
                    const finishTool = getTool('finishRequest');
                    if (finishTool) {
                        await finishTool({
                            summary: "Request completed after sending message",
                            reasoning: "One message per user request is the standard behavior"
                        }, threadContext);
                        
                        requestCompleted = true;
                        console.log("✅ Auto-completed request after message was sent");
                        break;
                    }
                }
                
                // If this is a button selection, auto-complete after first message
                // This prevents the LLM from sending multiple responses
                if (isButtonSelection && buttonResponses >= MAX_BUTTON_MESSAGES) {
                    console.log(`Button selection was already visually acknowledged - stopping iterations after first message`);
                    requestCompleted = true;
                    
                    // Auto-finish the request
                    const finishTool = getTool('finishRequest');
                    if (finishTool) {
                        await finishTool({
                            summary: "Button selection completed after first response message",
                            reasoning: "Button selection was already visually acknowledged - stopping iterations after first message"
                        }, threadContext);
                    }
                    
                    break;
                }
            }

        } catch (error) {
            console.log(`Error in process loop: ${error.message}`);
            
            // Handle error through the LLM
            try {
                // Format the error
                const { formatErrorForLLM } = require('./errors.js');
                const formattedError = formatErrorForLLM(error);
                
                // Store the error in context builder
                contextBuilder.recordToolExecution(threadId, 'error_handler', 
                    { 
                        source: error.source || 'processThread',
                        operation: error.operation || 'unknown'
                    }, 
                    formattedError,
                    error);
                
                // Add as system message for context
                contextBuilder.addMessage({
                    source: 'system',
                    id: `error_${Date.now()}`,
                    timestamp: new Date().toISOString(),
                    threadTs: threadId,
                    text: `Error: ${error.message}`,
                    type: 'error',
                    metadata: {
                        error: formattedError
                    }
                });
                
                // Skip to next iteration to let LLM handle the error
                continue;
            } catch (handlerError) {
                console.log(`Error handling error: ${handlerError.message}`);
                break;
            }
        }
    }

    // If we reached max iterations without explicit finishRequest
    if (iteration >= MAX_ITERATIONS && !requestCompleted) {
        console.log(`⚠️ Reached maximum iterations (${MAX_ITERATIONS}) without explicit finishRequest - auto-completing`);
        
        // Auto-finish the request
        try {
            const finishTool = getTool('finishRequest');
            if (finishTool) {
                await finishTool({
                    summary: `Auto-completed after ${iteration} iterations`,
                    reasoning: "Maximum iterations reached without explicit finishRequest"
                }, {
                    threadId: threadId,
                    threadTs: context?.threadTs,
                    channelId: context?.channelId
                });
            }
        } catch (error) {
            console.log(`Error auto-finishing request: ${error.message}`);
        }
    }
}

/**
 * Process button interaction event
 * @param {Object} payload - The button click payload from Slack
 * @returns {Promise<void>}
 */
async function processButtonInteraction(payload) {
  try {
    // Extract key information
    const actionId = payload.actions[0].action_id;
    const actionValue = payload.actions[0].value;
    const buttonText = payload.actions[0].text?.text || actionValue;
    const userId = payload.user.id;
    const channelId = payload.channel.id;
    const threadTs = payload.message.thread_ts || payload.container.message_ts;
    const messageTs = payload.container.message_ts;
    
    // Log button click event for debugging
    console.log(`\n👆 BUTTON CLICK`);
    console.log(`User: ${userId} | Action: ${actionId} | Value: ${actionValue}`);
    console.log(`Channel: ${channelId} | Thread: ${threadTs}`);
    console.log(`--------------------------------`);
    
    // Create thread ID (consistent with our other code)
    const threadId = threadTs || channelId;
    
    // Get context builder
    const contextBuilder = getContextBuilder();
    
    // Update thread context to indicate this is a button click
    contextBuilder.setMetadata(threadId, 'context', {
      userId,
      channelId,
      threadTs,
      isButtonClick: true,
      buttonText,
      actionValue,
      timestamp: Date.now().toString()
    });
    
    // Update the button UI in Slack FIRST - this is critical
    const updateResult = await updateButtonMessage(payload, {
      threadId: threadId,
      threadTs: threadTs,
      channelId: channelId,
      getButtonState: (actionId) => contextBuilder.getButtonState(threadId, actionId),
      setButtonState: (actionId, state, metadata) => contextBuilder.setButtonState(threadId, actionId, state, metadata)
    });
    
    console.log(`Button update result:`, updateResult.updated ? 'SUCCESS' : 'FAILED');
    
    // Add button click to context
    contextBuilder.addMessage({
      source: 'button_click',
      originalContent: payload,
      id: `button_${messageTs}_${Date.now()}`,
      userId: userId,
      threadTs: threadId,
      timestamp: new Date().toISOString(),
      text: `User clicked the "${buttonText}" button with value "${actionValue}". The original message has ALREADY been updated to show this selection.`,
      type: 'button_click',
      metadata: {
        buttonText,
        buttonValue: actionValue,
        messageTs,
        channelId,
        actionId,
        type: 'button_selection'
      }
    });
    
    console.log('Added button click feedback to context');
    
    // Process the thread - this will trigger a new LLM interaction
    await processThread(threadId);
  } catch (error) {
    console.error(`Error handling button interaction:`, error);
    
    // Simple error handling
    try {
      const slackClient = getSlackClient();
      await slackClient.chat.postMessage({
        channel: payload.channel.id,
        thread_ts: payload.message.thread_ts || payload.container.message_ts,
        text: "I'm sorry, I encountered an error processing your button click. Please try again or contact support."
      });
    } catch (sendError) {
      console.error(`Failed to send error message:`, sendError);
    }
  }
}

/**
 * Handle a button click event from Slack
 * @param {Object} payload - The button click payload from Slack
 * @returns {Promise<void>}
 */
async function handleButtonClick(payload) {
  // Call our updated processButtonInteraction function
  await processButtonInteraction(payload);
}

module.exports = {
    handleIncomingSlackMessage,
    handleButtonClick,
    executeTool,
    processThread
};