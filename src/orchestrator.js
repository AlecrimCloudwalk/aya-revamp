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

        // Right before the actual tool call - avoid logging large argument objects for getThreadHistory
        if (toolName === 'getThreadHistory') {
            const simplifiedArgs = {
                limit: sanitizedArgs.limit,
                threadTs: sanitizedArgs.threadTs,
                includeParent: sanitizedArgs.includeParent,
                forceRefresh: sanitizedArgs.forceRefresh
            };
            logger.info(`Executing tool ${toolName} with parameters: ${JSON.stringify(simplifiedArgs, null, 2)}`);
        } else {
            logger.info(`Executing tool ${toolName} with parameters: ${JSON.stringify(sanitizedArgs, null, 2)}`);
        }

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
        
        // Record the tool execution in context builder, but create a summarized version of large results
        if (toolName === 'getThreadHistory' && result) {
            // Create a summarized version of the getThreadHistory result to prevent log bloat
            const summarizedResult = {
                messagesRetrieved: result.messagesRetrieved,
                threadTs: result.threadTs,
                channelId: result.channelId,
                threadStats: result.threadStats,
                indexInfo: result.indexInfo,
                contextRebuilt: result.contextRebuilt,
                fromCache: result.fromCache,
                // Exclude full message content and formatted history to reduce log size
                messagesCount: result.messages ? result.messages.length : 0
            };
            contextBuilder.recordToolExecution(threadId, toolName, sanitizedArgs, summarizedResult);
        } else {
            contextBuilder.recordToolExecution(threadId, toolName, sanitizedArgs, result);
        }
        
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
        
        // Track consecutive similar operations to detect loops
        let consecutiveSimilarOperations = 0;
        let lastOperationType = null;
        let waitingForFinishRequest = false;
        let idleIterations = 0;
        
        // Array to store recent messages to help detect duplicates
        let recentMessages = contextBuilder.getMetadata(threadId, 'recentMessages') || [];
        
        // Check if this is a button selection
        const isButtonSelection = contextBuilder.getMetadata(threadId, 'isButtonSelection') || false;
        
        // Add a warning note if we're in a direct message with minimal context
        if (context && context.isDirectMessage) {
            const messages = contextBuilder.getThreadMessages(threadId) || [];
            if (messages.length <= 2) {
                contextBuilder.addMessage({
                    source: 'system',
                    text: `📝 NOTE: You are in a direct message with the user. Keep responses helpful and concise. Always complete your response by calling finishRequest.`,
                    timestamp: new Date().toISOString(),
                    threadTs: threadId
                });
            }
        }
        
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
                
                // Check for idle iterations with no meaningful progress
                if (messagePosted && iteration > 2 && idleIterations > 1) {
                    logger.warn(`⚠️ Detected ${idleIterations} idle iterations after posting a message - auto-finishing request`);
                    
                    // Add explicit guidance message
                    contextBuilder.addMessage({
                        source: 'system',
                        text: `⚠️ AUTO-FINISHING: The conversation has stalled after posting a message. The response has been completed and the request will be automatically finished. Next time, please call finishRequest directly after completing your response.`,
                        timestamp: new Date().toISOString(),
                        threadTs: threadId
                    });
                    
                    // Auto-finish the request
                    const finishTool = getTool('finishRequest');
                    if (finishTool) {
                        await finishTool({
                            summary: "Auto-finishing after stalled conversation",
                            reasoning: `Posted message but no finishRequest call after ${idleIterations} iterations`
                        }, getThreadContext(threadId, context));
                    }
                    
                    requestCompleted = true;
                    break;
                }
                
                // Add warning if waiting for finishRequest for too long
                if (waitingForFinishRequest && iteration > 3) {
                    logger.warn(`⚠️ Waiting for finishRequest for ${iteration - 3} iterations`);
                    
                    // After 2 iterations of waiting, force finishRequest
                    if (iteration - 3 >= 2) {
                        logger.warn(`🛑 Force finishing request after waiting too long`);
                        
                        // Add system message about forced completion
                        contextBuilder.addMessage({
                            source: 'system',
                            text: `⚠️ IMPORTANT: Your response has been delivered, but you didn't call finishRequest to complete the interaction. Always call finishRequest after posting your response to the user.`,
                            timestamp: new Date().toISOString(),
                            threadTs: threadId
                        });
                        
                        // Auto-finish the request
                        const finishTool = getTool('finishRequest');
                        if (finishTool) {
                            await finishTool({
                                summary: "Auto-finishing after response completed",
                                reasoning: `Response was sent but finishRequest wasn't called`
                            }, getThreadContext(threadId, context));
                        }
                        
                        requestCompleted = true;
                        break;
                    }
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
                    
                    // Set flag to indicate we're waiting for finishRequest
                    waitingForFinishRequest = true;
                    
                    // Add explicit guidance if we're just waiting for finishRequest
                    if (iteration === 3) {
                        contextBuilder.addMessage({
                            source: 'system',
                            text: `⚠️ REMINDER: You've already responded to the user's request. Please call finishRequest now to complete this interaction.`,
                            timestamp: new Date().toISOString(),
                            threadTs: threadId
                        });
                    }
                }
                
                // Get the next action from the LLM
                const {toolCalls} = await getNextAction(threadId);
                
                // Track if this iteration produced meaningful actions
                let meaningfulActionTaken = false;
                
                // Process each tool call
                for (const {tool: toolName, parameters: args, reasoning} of toolCalls) {
                    // Add reasoning to args
                    args.reasoning = reasoning || args.reasoning;
                    
                    // Handle finishRequest specifically - this completes the conversation
                    if (toolName === 'finishRequest') {
                        logger.info('🏁 finishRequest called, completing conversation');
                        
                        // Execute finish request
                        await executeTool(toolName, args, threadId);
                        
                        // Mark request as completed and exit loop
                        requestCompleted = true;
                        break;
                    }

                    // Handle postMessage - track that we've posted a message
                    if (toolName === 'postMessage') {
                        // This is a meaningful action
                        meaningfulActionTaken = true;
                        
                        // If we execute this successfully, mark that we've posted a message
                        try {
                            const result = await executeTool(toolName, args, threadId);
                            
                            // If the message was actually sent (not skipped)
                            if (result && !result.skipped) {
                                messagePosted = true;
                                messagesSent++;
                                
                                // Reset consecutive similar operations
                                consecutiveSimilarOperations = 0;
                                
                                // Add a prompt to call finishRequest
                                contextBuilder.addMessage({
                                    source: 'system',
                                    text: `✅ Message sent successfully. Please call finishRequest now to complete this interaction.`,
                                    timestamp: new Date().toISOString(),
                                    threadTs: threadId
                                });
                            }
                        } catch (error) {
                            logger.error(`Error executing postMessage: ${error.message}`);
                        }
                        
                        // Update last operation for loop detection
                        lastOperationType = 'postMessage';
                    }
                    // Handle other tools
                    else {
                        // Track if this tool call is similar to the previous one
                        let isSimilarOperation = toolName === lastOperationType;
                        
                        if (isSimilarOperation) {
                            consecutiveSimilarOperations++;
                            // If we're repeating the same operation too many times, it's likely a loop
                            if (consecutiveSimilarOperations >= 3) {
                                logger.warn(`⚠️ Loop detected: ${consecutiveSimilarOperations} consecutive ${toolName} calls`);
                                
                                // Add system message about loop detection
                                contextBuilder.addMessage({
                                    source: 'system',
                                    text: `⚠️ LOOP DETECTED: You've called ${toolName} ${consecutiveSimilarOperations} times consecutively. Please respond to the user with postMessage and then call finishRequest.`,
                                    timestamp: new Date().toISOString(),
                                    threadTs: threadId
                                });
                                
                                // If we've already posted a message, auto-finish to break the loop
                                if (messagePosted) {
                                    logger.warn(`🛑 Auto-finishing to break tool execution loop`);
                                    
                                    // Auto-finish the request
                                    const finishTool = getTool('finishRequest');
                                    if (finishTool) {
                                        await finishTool({
                                            summary: "Auto-finishing to break tool execution loop",
                                            reasoning: `Detected ${consecutiveSimilarOperations} consecutive ${toolName} calls`
                                        }, getThreadContext(threadId, context));
                                    }
                                    
                                    requestCompleted = true;
                                    break;
                                }
                            }
                        } else {
                            // Reset counter if we're doing a different operation
                            consecutiveSimilarOperations = 0;
                        }
                        
                        // Special handling for getThreadHistory
                        if (toolName === 'getThreadHistory') {
                            handleGetThreadHistory(args, threadId, context, threadHistoryCalls, threadHistoryErrorCount);
                            threadHistoryCalls++;
                        } else {
                            // For other tools, execute normally
                            try {
                                await executeTool(toolName, args, threadId);
                                meaningfulActionTaken = true;
                            } catch (error) {
                                logger.error(`Error executing ${toolName}: ${error.message}`);
                                threadHistoryErrorCount++;
                            }
                        }
                        
                        // Update last operation type
                        lastOperationType = toolName;
                    }
                }
                
                // If the request is completed (finishRequest was called), exit the loop
                if (requestCompleted) {
                    break;
                }
                
                // If no meaningful action was taken this iteration, increment idle counter
                if (!meaningfulActionTaken) {
                    idleIterations++;
                } else {
                    // Reset idle counter if we did something meaningful
                    idleIterations = 0;
                }
                
                // Special handling for button selections
                if (isButtonSelection && buttonResponses === 0 && messagePosted) {
                    // Auto-finish button selection responses after first message
                    logger.info('Button selection response sent, auto-finishing request');
                    
                    // Auto-finish the request
                    const finishTool = getTool('finishRequest');
                    if (finishTool) {
                        await finishTool({
                            summary: "Auto-finishing after button selection response",
                            reasoning: `Button selection response completed`
                        }, getThreadContext(threadId, context));
                    }
                    
                    requestCompleted = true;
                    break;
                }
                
            } catch (iterationError) {
                logger.error(`Error in iteration ${iteration}: ${iterationError.message}`);
                // Continue to next iteration
            }
        }
        
        // If we reached maximum iterations without completing the request, auto-finish
        if (!requestCompleted) {
            logger.warn(`⚠️ Reached maximum iterations (${MAX_ITERATIONS}) without completing request, auto-finishing`);
            
            try {
                // If no message was posted, send a fallback message
                if (!messagePosted) {
                    logger.warn(`⚠️ No message posted after ${MAX_ITERATIONS} iterations, sending fallback message`);
                    
                    // Get basic context info
                    const channel = context?.channelId;
                    const threadTs = context?.threadTs;
                    
                    if (channel) {
                        // Send a fallback message
                        const postMessageTool = getTool('postMessage');
                        if (postMessageTool) {
                            await postMessageTool({
                                text: "#header: I'm processing your request\n\n#section: I need a moment to complete this task. I'll get back to you shortly.",
                                color: "#E01E5A",
                                thread_ts: threadTs,
                                reasoning: "Sending fallback message after reaching iteration limit"
                            }, getThreadContext(threadId, context));
                        }
                    }
                }
                
                // Auto-finish the request
                const finishTool = getTool('finishRequest');
                if (finishTool) {
                    await finishTool({
                        summary: "Auto-finishing after reaching maximum iterations",
                        reasoning: `Reached iteration limit (${MAX_ITERATIONS})`
                    }, getThreadContext(threadId, context));
                }
            } catch (finishError) {
                logger.error(`Error auto-finishing: ${finishError.message}`);
            }
        }
        
    } catch (error) {
        logger.error(`Error processing thread ${threadId}: ${error.message}`);
        logError('Error processing thread', error, { threadId });
    }
}

/**
 * Helper function to create a thread context object
 */
function getThreadContext(threadId, context) {
    return {
        threadId: threadId,
        threadTs: context?.threadTs,
        channelId: context?.channelId,
        addMessage: (message) => {
            message.threadTs = threadId;
            return getContextBuilder().addMessage(message);
        },
        // Add getMetadata method to fix the error in postMessage
        getMetadata: (key) => {
            if (key === 'context') {
                return context;
            }
            return context?.[key];
        }
    };
}

/**
 * Handle special processing for getThreadHistory tool
 */
function handleGetThreadHistory(args, threadId, context, callCount, errorCount) {
    // Check if this is an extra getThreadHistory call
    if (callCount > 0) {
        const contextBuilder = getContextBuilder();
        
        // Add warning if this is called multiple times
        if (callCount > 1) {
            const messages = contextBuilder.getThreadMessages(threadId) || [];
            const isDirectMessage = context?.isDirectMessage || false;
            
            // For DMs or simple threads, strongly discourage multiple history calls
            if (isDirectMessage && messages.length <= 2) {
                contextBuilder.addMessage({
                    source: 'system',
                    text: `⚠️ NOTE: You are in a direct message with only ${messages.length} messages. Thread history has already been loaded automatically. Multiple getThreadHistory calls are unnecessary and waste resources. Please respond directly to the user.`,
                    timestamp: new Date().toISOString(),
                    threadTs: threadId,
                    type: 'warning'
                });
            } else if (callCount > 2) {
                // Add strong warning after 3+ calls
                contextBuilder.addMessage({
                    source: 'system',
                    text: `⚠️ WARNING: getThreadHistory called ${callCount} times. This is excessive and inefficient. You already have the necessary context. Please focus on answering the user's query directly without requesting more history.`,
                    timestamp: new Date().toISOString(),
                    threadTs: threadId,
                    type: 'warning'
                });
            }
        }
        
        // Create a hard limit for thread history calls
        if (callCount > 3) {
            logger.warn(`⚠️ HARD LIMIT: getThreadHistory called ${callCount} times for thread ${threadId}`);
            
            // Record this as a skipped execution
            const skippedResult = {
                status: 'error',
                error: 'EXECUTION_LIMIT_REACHED',
                errorMessage: `Maximum getThreadHistory calls (3) reached for this conversation`,
                skipped: true,
                suggestion: 'You already have sufficient context. Please respond to the user without further history retrieval.'
            };
            
            // Record the skipped execution
            contextBuilder.recordToolExecution(threadId, 'getThreadHistory', args, skippedResult, null, true);
            
            // Add explicit system message
            contextBuilder.addMessage({
                source: 'system',
                text: `⚠️ LIMIT REACHED: You've called getThreadHistory ${callCount} times. This tool is being blocked to prevent inefficient usage. Please use the existing context and respond to the user.`,
                timestamp: new Date().toISOString(),
                threadTs: threadId,
                type: 'error_notice'
            });
            
            // Return the skipped result instead of executing the tool
            return skippedResult;
        }
    }
    
    // Execute the tool normally
    try {
        return executeTool('getThreadHistory', args, threadId);
    } catch (error) {
        logger.error(`Error executing getThreadHistory: ${error.message}`);
        throw error;
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