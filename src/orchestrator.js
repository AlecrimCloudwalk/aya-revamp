// Orchestrates the flow between Slack, LLM, and tools
const { getNextAction } = require('./llmInterface.js');
const tools = require('./tools/index.js');
const { getTool } = tools;
const { logError } = require('./errors.js');
const { getSlackClient } = require('./slackClient.js');
const { getContextBuilder } = require('./contextBuilder.js');
const { initializeContextIfNeeded } = require('./toolUtils/loadThreadHistory');
const { updateButtonMessage } = require('./buttonUpdater');
const logger = require('./toolUtils/logger');

/**
 * Handles an incoming message from Slack
 */
async function handleIncomingSlackMessage(context) {
    try {
        logger.info("📨 INCOMING MESSAGE");
        logger.info(`User: ${context.userId} | Channel: ${context.channelId}`);
        logger.info(`Text: "${context.text}"`);
        if (context.threadTs) logger.info(`Thread: ${context.threadTs}`);
        logger.info("--------------------------------");
        
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
            
            logger.info('Added incoming message to context builder');
        } catch (contextError) {
            logger.error('Error adding message to context builder:', contextError);
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
            logger.warn(`Failed to add reaction: ${reactionError.message}`);
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
            logger.warn(`Failed to update reaction: ${reactionError.message}`);
        }

    } catch (error) {
        logger.warn(`❌ ERROR HANDLING MESSAGE: ${error.message}`);
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
            logger.warn(`Failed to add error reaction: ${reactionError.message}`);
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
        logger.info(`Tool ${toolName} already executed with these args, skipping`);
        return contextBuilder.getToolResult(threadId, toolName, args);
    }

    try {
        logger.info(`📣 Executing tool: ${toolName}`);
        
        // STANDARDIZE: Handle reasoning parameter by moving it to the top level
        // We want reasoning to always be at the top level, not inside parameters
        let sanitizedArgs = { ...args };
        
        // Handle nested tool structure - this happens when the LLM returns 
        // { "tool": "toolName", "parameters": {...} } inside the parameters
        if (sanitizedArgs.tool && sanitizedArgs.parameters && sanitizedArgs.tool === toolName) {
            logger.info('Detected nested tool structure, extracting inner parameters');
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
            logger.info('Detected duplicate reasoning fields - keeping only top-level reasoning');
            delete sanitizedArgs.parameters.reasoning;
        }
        
        // If reasoning is only in parameters, move it to the top level
        if (!sanitizedArgs.reasoning && 
            sanitizedArgs.parameters && 
            sanitizedArgs.parameters.reasoning) {
            sanitizedArgs.reasoning = sanitizedArgs.parameters.reasoning;
            delete sanitizedArgs.parameters.reasoning;
            logger.info('Moved reasoning from parameters to top level for consistency');
        }
        
        logger.info(`Parameters:`, JSON.stringify(sanitizedArgs, null, 2));
        
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
            getToolExecutionHistory: (limit = 10) => contextBuilder.getToolExecutionHistory(threadId, limit)
        };

        // Pass the thread context object to the tool
        const result = await tool(sanitizedArgs, threadContext);
        
        // Record the tool execution in context builder
        contextBuilder.recordToolExecution(threadId, toolName, sanitizedArgs, result);
        
        return result;

    } catch (error) {
        logger.warn(`❌ Tool execution failed: ${error.message}`);
        // Add more detailed error information
        if (error.message.includes('JSON') || error.message.includes('array') || error.message.includes('object')) {
            logger.info(`💡 This might be a parameter formatting issue. Check that arrays and objects are correctly formatted.`);
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
        logger.warn(`⚠️ No parameters provided for ${toolName}`);
        return;
    }
    
    logger.info(`Parameter types for ${toolName}:`);
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
        
        logger.info(`  - ${key}: ${isArray ? 'array' : type}${additionalInfo}`);
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
    
    logger.info("--- THREAD CONTEXT ---");
    if (context) {
        logger.info(`Context: user=${context.userId}, channel=${context.channelId}, thread=${context.threadTs}${context.isButtonClick ? ', type=button_click' : ''}`);
        
        if (context.isButtonClick) {
            logger.info(`Button: text="${context.buttonText}", value="${context.actionValue}"`);
        } else {
            // Only show the first 40 characters of text to avoid large logs
            const textPreview = context.text && context.text.length > 40 ? 
                             `${context.text.substring(0, 40)}...` : context.text;
            logger.info(`Message: "${textPreview}"`);
        }
    } else {
        logger.info(`No context available`);
    }
    logger.info("-----------------------");

    // Initialize the context builder with thread history if needed
    try {
        await initializeContextIfNeeded(threadId);
    } catch (contextError) {
        logger.error('Error initializing context:', contextError);
        // Continue even if context initialization fails
    }

    // First, get the thread history to have better context for the LLM
    try {
        // Only fetch history if we're in a thread that exists
        if (context && context.threadTs) {
            logger.info("Fetching thread history for context...");
            
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
                    addMessage: (message) => {
                        message.threadTs = threadId;
                        return contextBuilder.addMessage(message);
                    }
                });
                
                // Log compact summary of the results
                const threadMessages = contextBuilder.getThreadMessages(threadId);
                logger.info(`Thread history: ${historyResult.messagesRetrieved || 0} retrieved, ${threadMessages ? threadMessages.length : 0} in context`);
                
                // Only log detailed message info in verbose mode
                if (process.env.DEBUG === 'true' || process.env.VERBOSE_LOGS === 'true') {
                    logger.info(`Thread message breakdown:`);
                    if (threadMessages && threadMessages.length > 0) {
                        const userCount = threadMessages.filter(m => m.source === 'user').length;
                        const botCount = threadMessages.filter(m => m.source === 'assistant').length;
                        const otherCount = threadMessages.filter(m => m.source !== 'user' && m.source !== 'assistant').length;
                        logger.info(`  Sources: ${userCount} user, ${botCount} bot, ${otherCount} other`);
                        
                        // Show first few message previews
                        const previewCount = Math.min(3, threadMessages.length);
                        const previews = threadMessages.slice(0, previewCount).map((msg, idx) => {
                            const text = msg.text || '[no text]';
                            const preview = text.length > 30 ? text.substring(0, 30) + '...' : text;
                            return `[${idx}] ${msg.source}: ${preview}`;
                        });
                        logger.info(`  Previews: ${previews.join(' | ')}`);
                    } else {
                        logger.info(`  No messages in thread context`);
                    }
                }
                
                // Record the tool execution so the LLM knows about it
                contextBuilder.recordToolExecution(threadId, 'getThreadHistory', 
                    { threadTs: context.threadTs, limit: 10 }, 
                    historyResult);
            }
        }
    } catch (historyError) {
        logger.warn(`Failed to get thread history: ${historyError.message}`);
        // Continue even if history fetch fails
    }

    // Right before calling getNextAction
    // Add check for minimum context messages
    if (context && context.threadTs) {
        const threadMessages = contextBuilder.getThreadMessages(threadId);
        
        // If we have thread history but no messages, try one more time to enforce loading
        if (context.threadTs && (!threadMessages || threadMessages.length <= 1)) {
            logger.warn(`Thread context minimal (${threadMessages?.length || 0} messages), attempting emergency load`);
            
            // As a last resort, try loading directly with context builder
            try {
                // Force reload of thread history
                const historyTool = getTool('getThreadHistory');
                if (historyTool) {
                    const historyResult = await historyTool({
                        threadTs: context.threadTs,
                        limit: 15, // Increase the limit to ensure we get enough history
                        includeParent: true,
                        reasoning: "Final attempt to load thread history"
                    }, {
                        threadId: threadId,
                        threadTs: context.threadTs,
                        channelId: context.channelId,
                        addMessage: (message) => {
                            message.threadTs = threadId;
                            // Force add to context, bypassing any validations
                            return contextBuilder.addMessage(message);
                        }
                    });
                    
                    // Log the result in a single line
                    const updatedMessages = contextBuilder.getThreadMessages(threadId);
                    logger.info(`Emergency thread load: ${historyResult.messagesRetrieved || 0} retrieved, now ${updatedMessages ? updatedMessages.length : 0} messages in context`);
                }
            } catch (emergencyError) {
                logger.error(`Emergency thread load failed: ${emergencyError.message}`);
            }
        }
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
        
        // Special handling for thread history displays - NEVER count these as duplicates
        // This allows users to request thread history multiple times and get updated results
        if (messageText.includes("Aqui está o histórico") || 
            messageText.includes("Histórico da conversa") ||
            messageText.includes("histórico da nossa conversa") ||
            (messageText.includes("[USER]") && messageText.includes("[BOT]"))) {
            
            logger.info("Thread history display detected - bypassing duplicate detection");
            return false; // Never count thread history displays as duplicates
        }
        
        for (const prevMessage of recentMessages) {
            // Only consider the message as a duplicate if it's nearly identical
            // The current check is too aggressive and blocks legitimate new responses
            
            // Previous check - too restrictive, blocks legitimate responses:
            // if (prevMessage.substring(0, 20) === messageText.substring(0, 20)) {
            //    logger.warn("⚠️ Detected similar message beginning, possible duplicate");
            //    return true;
            // }
            
            // More precise duplicate detection:
            // 1. Check if messages are very similar in length (within 10%)
            const lengthRatio = Math.min(prevMessage.length, messageText.length) / 
                               Math.max(prevMessage.length, messageText.length);
                               
            // 2. Check for exact duplication (at least 90% match)
            const exactMatchThreshold = 0.9;
            let matchCount = 0;
            const minLength = Math.min(prevMessage.length, messageText.length);
            
            for (let i = 0; i < minLength; i++) {
                if (prevMessage[i] === messageText[i]) {
                    matchCount++;
                }
            }
            
            const matchRatio = matchCount / minLength;
            
            if (lengthRatio > 0.9 && matchRatio > exactMatchThreshold) {
                logger.warn(`⚠️ Detected near-exact duplicate message (${Math.round(matchRatio * 100)}% match)`);
                return true;
            }
            
            // 3. Allow similar topics but different content
            // This ensures responses to follow-up questions aren't blocked
        }
        
        return false;
    }
    
    while (iteration < MAX_ITERATIONS && !requestCompleted) {
        iteration++;
        logger.info(`🔄 Iteration ${iteration}/${MAX_ITERATIONS}`);
        
        // Store the current iteration number for context
        contextBuilder.setMetadata(threadId, 'iterations', iteration);

        try {
            // If we've already sent a message, strongly encourage finishing the request
            if (messagePosted && messagesSent >= MAX_MESSAGES_PER_REQUEST) {
                logger.info(`Already sent ${messagesSent} messages, but allowing LLM to continue processing`);
                
                // Auto-finish disabled: Let the LLM decide when to end the conversation
                /*
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
                        addMessage: (message) => {
                            message.threadTs = threadId;
                            return contextBuilder.addMessage(message);
                        }
                    });
                    
                    requestCompleted = true;
                    logger.info("✅ Auto-completed request after message was sent");
                    break;
                }
                */
            }

            // Get next action from LLM
            const llmResult = await getNextAction(threadId);
            
            // Check for tool calls
            const { toolCalls } = llmResult;
            if (!toolCalls?.length) {
                logger.info("No tool calls found in LLM response");
                break;
            }

            // Execute the first tool call
            const { tool: toolName, parameters: args } = toolCalls[0];
            lastToolExecuted = toolName;
            
            // If tool is postMessage, check for duplicate content
            if (toolName === 'postMessage' && args?.text) {
                if (isSimilarToRecent(args.text)) {
                    logger.warn("⚠️ Skipping duplicate message content");
                    
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
                            addMessage: (message) => {
                                message.threadTs = threadId;
                                return contextBuilder.addMessage(message);
                            }
                        });
                        
                        requestCompleted = true;
                        logger.info("✅ Auto-completed request to prevent duplicate messages");
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
                    logger.info(`Reached maximum messages (${MAX_BUTTON_MESSAGES}) for button selection - stopping iterations`);
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
                            addMessage: (message) => {
                                message.threadTs = threadId;
                                return contextBuilder.addMessage(message);
                            }
                        });
                    }
                    
                    break;
                }
            }
            
            // Add proper thread context with working addMessage
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
                getToolExecutionHistory: (limit = 10) => contextBuilder.getToolExecutionHistory(threadId, limit)
            };
            
            // Execute the tool
            const result = await executeTool(toolName, args, threadId);

            // If the tool was finishRequest, we're done
            if (toolName === 'finishRequest') {
                requestCompleted = true;
                logger.info("Request finished with finishRequest tool");
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
                    logger.info("Multiple messages allowed - letting LLM continue processing");
                    
                    // Auto-finish disabled: Let the LLM decide when to end the conversation
                    /*
                    // Auto-finish the request
                    const finishTool = getTool('finishRequest');
                    if (finishTool) {
                        await finishTool({
                            summary: "Request completed after sending message",
                            reasoning: "One message per user request is the standard behavior"
                        }, threadContext);
                        
                        requestCompleted = true;
                        logger.info("✅ Auto-completed request after message was sent");
                        break;
                    }
                    */
                }
                
                // If this is a button selection, auto-complete after first message
                // This prevents the LLM from sending multiple responses
                if (isButtonSelection && buttonResponses >= MAX_BUTTON_MESSAGES) {
                    logger.info(`Button selection was already visually acknowledged - stopping iterations after first message`);
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
            logger.warn(`Error in process loop: ${error.message}`);
            
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
                logger.warn(`Error handling error: ${handlerError.message}`);
                break;
            }
        }
    }

    // If we reached max iterations without explicit finishRequest
    if (iteration >= MAX_ITERATIONS && !requestCompleted) {
        logger.warn(`⚠️ Reached maximum iterations (${MAX_ITERATIONS}) without explicit finishRequest - auto-completing`);
        
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
            logger.warn(`Error auto-finishing request: ${error.message}`);
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
    
    // Enhanced logging for button interactions
    logger.info(`🔘 BUTTON PROCESSING: "${buttonText}" (${actionValue})`);
    logger.info(`Thread context: channel=${channelId}, thread_ts=${threadTs}, user=${userId}`);
    
    // Log additional diagnostics for debugging
    if (process.env.NODE_ENV !== 'production') {
      logger.detail(`Full button payload:`, {
        user: userId,
        channel: channelId,
        message_ts: messageTs,
        thread_ts: threadTs,
        action_id: actionId,
        value: actionValue,
        button_text: buttonText
      });
    }
    
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
    
    // Log payload structure for debugging
    logger.logButtonClick(payload);
    
    // Update the button UI in Slack FIRST - this is critical
    const updateResult = await updateButtonMessage(payload, {
      threadId: threadId,
      threadTs: threadTs,
      channelId: channelId,
      getButtonState: (actionId) => contextBuilder.getButtonState(threadId, actionId),
      setButtonState: (actionId, state, metadata) => contextBuilder.setButtonState(threadId, actionId, state, metadata)
    });
    
    logger.info(`Button update ${updateResult.updated ? 'succeeded' : 'failed'}`);
    
    if (!updateResult.updated) {
      logger.error(`Button update failed: ${updateResult.error}`);
      
      // Instead of sending a hardcoded message, use the LLM to handle the response
      // First, ensure the error is added to the context
      const buttonUpdateError = new Error(`Button update failed: ${updateResult.error}`);
      
      const { handleErrorWithLLM } = require('./errors.js');
      
      // Create error context with button information
      const errorContext = {
        channelId,
        threadTs,
        userId,
        isError: true,
        isButtonClick: true,
        buttonText,
        actionValue,
        errorSource: 'button_update_failure',
        updateResult
      };
      
      // Let the LLM handle the button update failure response
      await handleErrorWithLLM(buttonUpdateError, errorContext);
      
    } else if (!updateResult.actionsBlockFound) {
      logger.warn(`Button was clicked but no actions block was found to update`);
      
      // This means the UI wasn't visually updated, so the LLM should inform the user
      if (payload.message) {
        logger.detail(`Payload message info:`, {
          ts: payload.message.ts,
          has_attachments: !!payload.message.attachments,
          attachment_count: payload.message.attachments?.length || 0
        });
      }
      
      // Instead of a hardcoded message, add system message to context and let the LLM decide
      contextBuilder.addMessage({
        source: 'system',
        id: `button_update_note_${Date.now()}`,
        timestamp: new Date().toISOString(),
        threadTs: threadId,
        text: `Button with text "${buttonText}" (value: "${actionValue}") was clicked by user <@${userId}>, but no actions block was found to update. The UI was not visually updated. The LLM should acknowledge this selection.`,
        type: 'system_note',
        metadata: {
          isButtonClick: true,
          buttonText,
          actionValue,
          uiUpdated: false,
          type: 'button_selection_ui_status'
        }
      });
    }
    
    // Add button click to context
    contextBuilder.addMessage({
      source: 'button_click',
      originalContent: payload,
      id: `button_${messageTs}_${Date.now()}`,
      userId: userId,
      threadTs: threadId,
      timestamp: new Date().toISOString(),
      text: `User clicked the "${buttonText}" button with value "${actionValue}". ${updateResult.updated ? 'The original message has been updated to show this selection.' : 'Button update status: FAILED.'}`,
      type: 'button_click',
      metadata: {
        buttonText,
        buttonValue: actionValue,
        messageTs,
        channelId,
        actionId,
        type: 'button_selection',
        updateStatus: updateResult.updated ? 'success' : 'failed',
        error: updateResult.error || null
      }
    });
    
    logger.info('Added button click to context, processing thread');
    
    // Process the thread - this will trigger a new LLM interaction
    await processThread(threadId);
  } catch (error) {
    logger.error(`Error handling button interaction:`, error);
    
    // Enhanced error handling using LLM
    try {
      // Import the error handler instead of sending a hardcoded message
      const { handleErrorWithLLM } = require('./errors.js');
      
      // Create error context
      const errorContext = {
        channelId: payload.channel?.id,
        threadTs: payload.message?.thread_ts || payload.container?.message_ts,
        userId: payload.user?.id,
        isError: true,
        isButtonClick: true,
        buttonText: payload.actions?.[0]?.text?.text || payload.actions?.[0]?.value || 'unknown button',
        actionValue: payload.actions?.[0]?.value,
        errorSource: 'button_interaction_processing'
      };
      
      // Handle error through the LLM
      await handleErrorWithLLM(error, errorContext);
      
    } catch (sendError) {
      logger.error(`Failed to send error message: ${sendError.message}`);
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