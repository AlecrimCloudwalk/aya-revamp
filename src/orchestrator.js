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
const getThreadHistoryTool = require('./tools/getThreadHistory');
const callCounter = getThreadHistoryTool.callCounter || new Map();

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
    
    // Special handling for getThreadHistory to prevent loops
    if (toolName === 'getThreadHistory') {
        // Check for previous failures
        const recentExecutions = contextBuilder.getToolExecutionHistory(threadId, 5);
        const recentFailures = recentExecutions.filter(
            exec => exec.toolName === 'getThreadHistory' && exec.error
        );
        
        if (recentFailures.length >= 2) {
            logger.warn(`⚠️ LOOP PREVENTION: Blocking repeated getThreadHistory calls after ${recentFailures.length} failures`);
            // Return helpful error message instead of executing the tool again
            
            // Record this as a skipped tool execution
            const skippedResult = {
                status: 'error',
                error: 'REPEATED_FAILURES',
                errorMessage: 'Multiple getThreadHistory failures detected',
                suggestion: 'Please respond directly to the user with postMessage instead of trying to get thread history',
                skipRetry: true,
                skipped: true
            };
            
            contextBuilder.recordToolExecution(threadId, toolName, args, skippedResult, null, true);
            
            return skippedResult;
        }
    }
    
    // Check if we've already executed this exact tool call
    if (contextBuilder.hasExecuted(threadId, toolName, args)) {
        logger.info(`Tool ${toolName} already executed with these args, skipping`);
        
        // Get the previous result
        const previousResult = contextBuilder.getToolResult(threadId, toolName, args);
        
        // Enhanced error message for duplicate postMessage
        if (toolName === 'postMessage') {
            // Record this as a skipped execution, not an error but a special status
            const skippedResult = {
                ...previousResult,
                status: previousResult.status || 'success',
                skipped: true,
                message: `You are trying to send a very similar or identical message to one already sent. If the user is asking for more information or clarification, please provide a substantially different and more detailed response. Focus on expanding on specific aspects the user might be asking about.`
            };
            
            // Update context with this skipped execution
            contextBuilder.recordToolExecution(threadId, toolName, args, skippedResult, null, true);
            
            // Get the user's most recent message to provide better context
            const recentMessages = contextBuilder.getThreadMessages(threadId) || [];
            const userMessages = recentMessages.filter(msg => msg.source === 'user');
            const latestUserMessage = userMessages.length > 0 ? 
                userMessages[userMessages.length - 1].text : 
                'unknown message';
            
            // Add explicit system message for guidance - more specific to the user's query
            contextBuilder.addMessage({
                source: 'system',
                text: `⚠️ SIMILAR MESSAGE DETECTED: You tried to send a message very similar to one you've already sent. The user's latest message was: "${latestUserMessage}". This likely means they're asking for more specific information or clarification. Please provide a NEW response with substantially different content that addresses their follow-up question more thoroughly.`,
                timestamp: new Date().toISOString(),
                threadTs: threadId,
                type: 'warning'
            });
            
            return skippedResult;
        } else {
            // For non-postMessage tools, use the standard skipped message
            const skippedResult = {
                ...previousResult,
                status: previousResult.status || 'success',
                skipped: true,
                message: `This same tool call was already executed with identical parameters. Reusing previous result.`
            };
            
            // Update context with this skipped execution
            contextBuilder.recordToolExecution(threadId, toolName, args, skippedResult, null, true);
            
            return skippedResult;
        }
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
        
        const tool = getTool(toolName);
        if (!tool) {
            throw new Error(`Tool ${toolName} not found`);
        }
        // Get existing recent messages from context
        let recentMessages = contextBuilder.getMetadata(threadId, 'recentMessages') || [];
        
        // Create an object with thread-specific context for the tool
        const threadContext = {
            threadId: threadId,
            channelId: contextBuilder.getChannel(threadId),
            threadTs: contextBuilder.getThreadTs(threadId),
            recentMessages: recentMessages, // Add recent messages for duplicate detection
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

        // Special debugging for getThreadHistory - simplified to reduce noise
        if (toolName === 'getThreadHistory') {
            const callNum = getThreadHistoryTool.callCounter.get(threadId) || 1;
            logger.info(`🔍 getThreadHistory call #${callNum} for thread ${threadId}`);
            
            // Only log essential parameters to reduce noise
            if (process.env.DEBUG_LLM === 'true') {
                const debugInfo = {
                    threadId: threadId,
                    argsThreadTs: sanitizedArgs.threadTs,
                    argsChannelId: sanitizedArgs.channelId,
                    argsLimit: sanitizedArgs.limit,
                    argsForceRefresh: sanitizedArgs.forceRefresh || false
                };
                logger.detail(`getThreadHistory params: ${JSON.stringify(debugInfo)}`);
            }
        }

        // Right before the actual tool call
        logger.info(`Executing tool ${toolName} with parameters: ${JSON.stringify(sanitizedArgs, null, 2)}`);

        // Add tool tracing to global namespace for debugging
        if (!global.toolTraces) {
            global.toolTraces = new Map();
        }
        if (!global.toolTraces.has(threadId)) {
            global.toolTraces.set(threadId, []);
        }
        global.toolTraces.get(threadId).push({
            timestamp: new Date().toISOString(),
            tool: toolName,
            args: sanitizedArgs
        });

        // Pass the thread context object to the tool
        const result = await tool(sanitizedArgs, threadContext);
        
        // If this is a message post, add it to recent messages
        if (toolName === 'postMessage' && result && result.status !== 'error' && sanitizedArgs.text) {
            recentMessages.push({
                text: sanitizedArgs.text,
                timestamp: Date.now(),
                toolName: toolName
            });
            
            // Only keep recent 10 messages
            if (recentMessages.length > 10) {
                recentMessages = recentMessages.slice(-10);
            }
            
            // Store updated recent messages
            contextBuilder.setMetadata(threadId, 'recentMessages', recentMessages);
        }
        
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
 * Processes a thread with the LLM
 */
async function processThread(threadId) {
    const MAX_ITERATIONS = 10;
    let iteration = 0;
    
    try {
        // Get context builder
        const contextBuilder = getContextBuilder();
        
        // Debug log: Print what context is stored
        const context = contextBuilder.getMetadata(threadId, 'context');
        
        // Initialize the context builder with thread history if needed
        try {
            await initializeContextIfNeeded(threadId);
        } catch (contextError) {
            logger.error('Error initializing context:', contextError);
            // Continue even if context initialization fails
        }

        // First, load thread history directly using internal function instead of the tool
        try {
            // Only fetch history if we're in a thread that exists
            if (context && context.threadTs) {
                logger.info("Loading thread history for context...");
                
                // Load history using internal function instead of the tool
                await loadThreadHistoryIntoContext(threadId, context.threadTs, context.channelId);
            }
        } catch (historyError) {
            logger.warn(`Failed to load thread history: ${historyError.message}`);
            // Continue even if history load fails
        }

        // Variables to track state across iterations
        let requestCompleted = false;
        let lastToolExecuted = null;
        let buttonResponses = 0;
        let messagePosted = false;
        let messagesSent = 0;
        const MAX_MESSAGES_PER_REQUEST = 3;
        
        // Track getThreadHistory calls
        let threadHistoryCalls = 0;
        let threadHistoryErrorCount = 0;
        
        // Array to store recent messages to help detect duplicates
        let recentMessages = [];
        
        // Check if this is a button selection
        const isButtonSelection = contextBuilder.getMetadata(threadId, 'isButtonSelection') || false;
        
        // LLM-driven processing loop
        for (iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
            try {
                // Check if we've already sent all allowed messages
                if (messagesSent >= MAX_MESSAGES_PER_REQUEST && messagePosted) {
                    logger.info(`Reached maximum messages (${MAX_MESSAGES_PER_REQUEST}) - stopping iterations`);
                    
                    // Auto-finish the request
                    const finishTool = getTool('finishRequest');
                    if (finishTool) {
                        await finishTool({
                            summary: "Auto-finishing after maximum messages sent",
                            reasoning: `Maximum number of messages (${MAX_MESSAGES_PER_REQUEST}) reached`
                        }, {
                            threadId: threadId,
                            threadTs: context?.threadTs,
                            channelId: context?.channelId,
                            addMessage: (message) => {
                                message.threadTs = threadId;
                                return contextBuilder.addMessage(message);
                            }
                        });
                    }
                    
                    requestCompleted = true;
                    break;
                }
                
                // Update iteration metadata
                contextBuilder.setMetadata(threadId, 'iterations', iteration);
                
                // Log iteration with clear separation
                logger.info(`\n🔄 Iteration ${iteration}/${MAX_ITERATIONS}`);
                
                // Add additional warnings if many iterations without completion
                if (iteration >= MAX_ITERATIONS - 2) {
                    contextBuilder.addMessage({
                        source: 'system',
                        text: `⚠️ WARNING: You are reaching the maximum allowed iterations (${MAX_ITERATIONS}). Please complete this request by calling finishRequest or the request will be auto-completed.`,
                        timestamp: new Date().toISOString(),
                        threadTs: threadId
                    });
                }
                
                // If we've already sent a message but haven't called finishRequest yet, add a note
                if (messagePosted && iteration > 1) {
                    logger.info(`Already sent ${messagesSent} messages, but allowing LLM to continue processing`);
                }
                
                // Get the next action from the LLM
                const {toolCalls} = await getNextAction(threadId);
                
                // Process each tool call
                for (const {tool: toolName, parameters: args, reasoning} of toolCalls) {
                    // Add reasoning to args
                    args.reasoning = reasoning || args.reasoning;
                    
                    // Check if this is an extra getThreadHistory call
                    if (toolName === 'getThreadHistory') {
                        threadHistoryCalls++;
                        
                        // Add warning if this is called multiple times
                        if (threadHistoryCalls > 1) {
                            const messages = contextBuilder.getThreadMessages(threadId) || [];
                            const context = contextBuilder.getMetadata(threadId, 'context') || {};
                            const isDirectMessage = context.isDirectMessage || false;
                            
                            // For DMs or simple threads, strongly discourage multiple history calls
                            if (isDirectMessage && messages.length <= 2) {
                                contextBuilder.addMessage({
                                    source: 'system',
                                    text: `⚠️ NOTE: You are in a direct message with only ${messages.length} messages. Thread history has already been loaded automatically. Multiple getThreadHistory calls are unnecessary and waste resources. Please respond directly to the user.`,
                                    timestamp: new Date().toISOString(),
                                    threadTs: threadId,
                                    type: 'warning'
                                });
                            } else if (threadHistoryCalls > 2) {
                                // Add strong warning after 3+ calls
                                contextBuilder.addMessage({
                                    source: 'system',
                                    text: `⚠️ WARNING: getThreadHistory called ${threadHistoryCalls} times. This is excessive and inefficient. You already have the necessary context. Please focus on answering the user's query directly without requesting more history.`,
                                    timestamp: new Date().toISOString(),
                                    threadTs: threadId,
                                    type: 'warning'
                                });
                            }
                        }
                        
                        // Create a hard limit for thread history calls
                        if (threadHistoryCalls > 3) {
                            logger.warn(`⚠️ HARD LIMIT: getThreadHistory called ${threadHistoryCalls} times for thread ${threadId}`);
                            
                            // Record this as a skipped execution
                            const skippedResult = {
                                status: 'error',
                                error: 'EXECUTION_LIMIT_REACHED',
                                errorMessage: `Maximum getThreadHistory calls (3) reached for this conversation`,
                                skipped: true,
                                suggestion: 'You already have sufficient context. Please respond to the user without further history retrieval.'
                            };
                            
                            contextBuilder.recordToolExecution(threadId, toolName, args, skippedResult, null, true);
                            
                            // Add explicit system message
                            contextBuilder.addMessage({
                                source: 'system',
                                text: `⛔ BLOCKED: getThreadHistory has been called too many times (${threadHistoryCalls}). The tool is now disabled for this conversation. You have all necessary context - please respond to the user directly.`,
                                timestamp: new Date().toISOString(),
                                threadTs: threadId,
                                type: 'error'
                            });
                            
                            continue;
                        }
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
                    
                    // Process tool call
                    let result;
                    try {
                        // Execute the tool
                        result = await executeTool(toolName, args, threadId);
                        
                        // Reset error count on success
                        if (toolName === 'getThreadHistory' && !result.error) {
                            threadHistoryErrorCount = 0;
                        }
                        
                        // Update metadata
                        lastToolExecuted = toolName;
                        
                        // Track message posting
                        if (toolName === 'postMessage' && result && result.ts) {
                            messagePosted = true;
                            messagesSent++;
                            
                            // Store message text to detect duplicates
                            if (args.text) {
                                recentMessages.push({
                                    text: args.text,
                                    timestamp: Date.now()
                                });
                            }
                            
                            // Add system instruction after successful message posting
                            try {
                                const { formatTimestamp } = require('./toolUtils/dateUtils');
                                let formattedTime = 'just now';
                                try {
                                    formattedTime = formatTimestamp(new Date());
                                } catch (timeError) {
                                    logger.warn(`Error formatting timestamp in processThread: ${timeError.message}`);
                                }
                                
                                contextBuilder.addMessage({
                                    source: 'system',
                                    text: `Message was successfully posted at ${formattedTime}. Decide if you want to call finishRequest to complete this user interaction or wait for user response.`,
                                    timestamp: new Date().toISOString(),
                                    threadTs: threadId
                                });
                            } catch (systemMsgError) {
                                logger.warn(`Error adding system message after post: ${systemMsgError.message}`);
                            }
                            
                            logger.info(`✅ Message posted successfully (${messagesSent}/${MAX_MESSAGES_PER_REQUEST})`);
                        }
                        
                        // Check for request completion
                        if (toolName === 'finishRequest') {
                            requestCompleted = true;
                            logger.info("✅ Request completed with finishRequest");
                            break;
                        }
                    } catch (error) {
                        logger.warn(`❌ Tool execution error: ${error.message}`);
                        
                        // Track getThreadHistory errors
                        if (toolName === 'getThreadHistory') {
                            threadHistoryErrorCount++;
                            
                            // After multiple failures, add stronger guidance
                            if (threadHistoryErrorCount >= 2) {
                                contextBuilder.addMessage({
                                    source: 'system',
                                    text: `⚠️ CRITICAL: Thread history retrieval has failed ${threadHistoryErrorCount} times. DO NOT try again. Instead, respond directly to the user using the postMessage tool.`,
                                    timestamp: new Date().toISOString(),
                                    threadTs: threadId
                                });
                            }
                        }
                        
                        // Add error to context
                        contextBuilder.addMessage({
                            source: 'system',
                            text: `ERROR executing ${toolName}: ${error.message}\n\nYou should handle this error appropriately and decide what to do next.`,
                            timestamp: new Date().toISOString(),
                            threadTs: threadId
                        });
                        
                        // Continue with next iteration
                        continue;
                    }
                }
            } catch (error) {
                logger.warn(`Error processing thread: ${error.message}`);
                logger.detail(error.stack);
                
                // Add error to context
                contextBuilder.addMessage({
                    source: 'system',
                    text: `Error in thread processing: ${error.message}. Please try again with a different approach.`,
                    timestamp: new Date().toISOString(),
                    threadTs: threadId
                });
            }
        }
        
        if (iteration >= MAX_ITERATIONS && !requestCompleted) {
            logger.warn(`⚠️ Reached maximum iterations (${MAX_ITERATIONS}) without explicit finishRequest - auto-completing`);
            
            try {
                // Auto-finish the request
                const finishTool = getTool('finishRequest');
                if (finishTool) {
                    await finishTool({
                        summary: "Auto-completing after reaching maximum iterations",
                        reasoning: "Maximum iterations reached without explicit finishRequest"
                    }, {
                        threadId: threadId,
                        threadTs: context?.threadTs,
                        channelId: context?.channelId,
                        addMessage: (message) => {
                            message.threadTs = threadId;
                            return contextBuilder.addMessage(message);
                        }
                    });
                }
                
                logger.info("Request finished with finishRequest tool");
            } catch (finishError) {
                logger.error(`Error finishing request: ${finishError.message}`);
            }
        }
    } catch (error) {
        logger.error(`Error processing thread: ${error.message}`);
        logger.detail(error.stack);
        
        // Add error to context
        contextBuilder.addMessage({
            source: 'system',
            text: `Error in thread processing: ${error.message}. Please try again with a different approach.`,
            timestamp: new Date().toISOString(),
            threadTs: threadId
        });
    }
}

/**
 * Internal function to load thread history into context
 * This avoids using the getThreadHistory tool directly to prevent the LLM from seeing it in the context
 * @param {string} threadId - The thread ID
 * @param {string} threadTs - The thread timestamp
 * @param {string} channelId - The channel ID
 * @param {number} limit - Maximum number of messages to retrieve
 * @param {boolean} isEmergencyLoad - Whether this is an emergency load attempt
 * @returns {Promise<Object>} - The history result
 */
async function loadThreadHistoryIntoContext(threadId, threadTs, channelId, limit = 10, isEmergencyLoad = false) {
    // Get context builder
    const contextBuilder = getContextBuilder();
    
    // Get the loadThreadHistory function directly
    const loadThreadHistory = getThreadHistoryTool.loadThreadHistory;
    
    // Load the history
    const historyResult = await loadThreadHistory({
        threadTs: threadTs,
        limit: limit,
        includeParent: true,
        reasoning: isEmergencyLoad ? "Emergency thread history load" : "Initial thread history load"
    }, {
        threadId: threadId,
        threadTs: threadTs,
        channelId: channelId,
        addMessage: (message) => {
            message.threadTs = threadId;
            return contextBuilder.addMessage(message);
        }
    });
    
    // Check if there was an error
    if (historyResult.error) {
        logger.warn(`Thread history error: ${historyResult.errorMessage || 'Unknown error'}`);
        // Add guidance for the LLM
        contextBuilder.addMessage({
            source: 'system',
            text: `Note: There was a problem loading some thread history. Using available context.`,
            timestamp: new Date().toISOString(),
            threadTs: threadId
        });
    } else {
        // Log compact summary of the results
        const threadMessages = contextBuilder.getThreadMessages(threadId);
        logger.info(`Thread history: ${historyResult.messagesRetrieved || 0} retrieved, ${threadMessages ? threadMessages.length : 0} in context`);
        
        // We do NOT record this as a tool execution since we don't want the LLM to see it
    }
    
    return historyResult;
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