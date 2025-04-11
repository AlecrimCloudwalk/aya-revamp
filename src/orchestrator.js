// Orchestrates the flow between Slack, LLM, and tools
const { getNextAction } = require('./llmInterface.js');
const tools = require('./tools/index.js');
const { getTool } = tools;
const { logError, createStandardizedErrorContext } = require('./errors.js');
const { getSlackClient } = require('./slackClient.js');
const { getContextBuilder } = require('./contextBuilder.js');
const { initializeContextIfNeeded } = require('./toolUtils/loadThreadHistory');
const { updateButtonMessage } = require('./buttonUpdater');
const logger = require('./toolUtils/logger');
const getThreadHistoryTool = require('./tools/getThreadHistory');
const callCounter = getThreadHistoryTool.callCounter || new Map();

/**
 * Handles an error during thread processing
 */
async function handleProcessingError(error, threadId, context = {}) {
  // Log error
  logError('Error processing thread', error, { threadId, ...context });
  
  // Create standardized error context
  const errorContext = createStandardizedErrorContext(error, 'orchestrator.processThread', {
    threadId,
    channelId: context.channelId,
    userId: context.userId,
    component: 'orchestrator'
  });
  
  // Get context builder
  const contextBuilder = getContextBuilder();
  
  // Add error to thread context
  contextBuilder.setMetadata(threadId, 'lastError', errorContext);
  
  // Add system message about error
  contextBuilder.addMessage({
    source: 'system',
    originalContent: errorContext,
    id: `error_${Date.now()}`,
    timestamp: new Date().toISOString(),
    threadTs: threadId,
    text: `Error occurred: ${errorContext.message}`,
    type: 'error',
    metadata: {
      error: true,
      errorContext
    }
  });
  
  // Let the LLM handle the error
  const { handleErrorWithLLM } = require('./errors.js');
  return await handleErrorWithLLM(error, { 
    threadTs: threadId, 
    channelId: context.channelId,
    userId: context.userId 
  });
}

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
        
        // Set timestamp for the message received
        contextBuilder.setMetadata(threadId, 'lastMessageTime', new Date().toISOString());
        
        // Explicitly check if the threadMessages map has an entry for this thread
        if (!contextBuilder.threadMessages.has(threadId)) {
            logger.info(`Creating new thread entry for ${threadId} in ContextBuilder`);
            contextBuilder.threadMessages.set(threadId, []);
        }
        
        // Add message to context - use a simple format to avoid processing issues
        try {
            const userMessage = {
                source: 'user',
                threadTs: threadId,
                text: context.text || '',
                timestamp: new Date().toISOString(),
                sourceId: context.userId,
                metadata: {
                    channel: context.channelId,
                    isDirectMessage: context.isDirectMessage || false,
                    isMention: context.isMention || false
                }
            };
            
            const addedMessage = contextBuilder.addMessage(userMessage);
            
            if (addedMessage) {
                logger.info(`✅ Successfully added user message to context: ${addedMessage.id}`);
                
                // Verify the message was actually added to the thread
                const threadMessages = contextBuilder.getThreadMessages(threadId);
                logger.info(`Thread ${threadId} now has ${threadMessages.length} messages`);
                
                // If first verification showed no messages, try to debug further
                if (threadMessages.length === 0) {
                    logger.error(`❌ CRITICAL: Message was not added to thread ${threadId}`);
                    
                    // Try explicit emergency message
                    const emergencyMessage = {
                        source: 'system',
                        threadTs: threadId,
                        text: '⚠️ EMERGENCY MESSAGE: Message tracking issue detected. Please respond to the user.',
                        timestamp: new Date().toISOString(),
                        id: `emergency_${Date.now()}`
                    };
                    
                    contextBuilder.addMessage(emergencyMessage);
                    logger.info('Added emergency system message as fallback');
                }
            } else {
                logger.error('❌ Failed to add message to context builder');
            }
        } catch (contextError) {
            logger.error(`Error adding message to context builder: ${contextError.message}`);
            logger.error(contextError.stack);
            // Continue with best effort
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
        logger.error(error.stack);
        
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
        
        // Handle processing error with enhanced error handling
        await handleProcessingError(error, context.threadTs || context.channelId, context);
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
        logger.info(`Thread context: ${JSON.stringify(context || {})}`);
        
        // Initialize the context builder with thread history if needed
        let contextInitialized = false;
        try {
            logger.info("Initializing context with thread history...");
            await initializeContextIfNeeded(threadId);
            contextInitialized = true;
            logger.info("Context initialization successful");
        } catch (contextError) {
            logger.error(`🚨 CRITICAL: Context initialization failed: ${contextError.message}`);
            
            // Add error message to context
            contextBuilder.addMessage({
                source: 'system',
                text: `🚨 CRITICAL: Context initialization failed. The bot may not have full conversation history. Error: ${contextError.message}`,
                timestamp: new Date().toISOString(),
                threadTs: threadId,
                type: 'error'
            });
            
            // Continue with limited context, but track the failure
            contextBuilder.setMetadata(threadId, 'contextInitFailed', true);
        }

        // Check what messages we have at this point
        const messagesBeforeFallback = contextBuilder.getThreadMessages(threadId);
        logger.info(`Messages in context before fallback: ${messagesBeforeFallback.length}`);
        
        // Dump message IDs for debugging
        if (messagesBeforeFallback.length === 0) {
            logger.error(`⚠️ EMPTY CONTEXT: No messages found for thread ${threadId}`);
        } else {
            logger.info(`Message IDs: ${messagesBeforeFallback.slice(0, 5).join(', ')}${messagesBeforeFallback.length > 5 ? '...' : ''}`);
        }

        // First, load thread history directly using internal function instead of the tool
        // Only do this if context initialization failed to provide a fallback mechanism
        if ((!contextInitialized || messagesBeforeFallback.length === 0) && context && context.threadTs) {
            try {
                logger.info("🔄 Attempting direct thread history load as fallback...");
                
                await loadThreadHistoryIntoContext(threadId, context.threadTs, context.channelId);
                logger.info("✅ Fallback history load successful");
                
                // Check again after fallback
                const messagesAfterFallback = contextBuilder.getThreadMessages(threadId);
                logger.info(`Messages in context after fallback: ${messagesAfterFallback.length}`);
            } catch (historyError) {
                logger.error(`❌ Failed to load thread history via fallback: ${historyError.message}`);
                
                // Add last-resort message
                const fallbackText = context?.text || "No text found";
                const fallbackUserId = context?.userId || "unknown";
                
                // Add a manual message as absolute last resort
                try {
                    logger.info(`Adding emergency user message with text: "${fallbackText}"`);
                    contextBuilder.addMessage({
                        source: 'user',
                        text: fallbackText,
                        timestamp: new Date().toISOString(),
                        threadTs: threadId,
                        sourceId: fallbackUserId,
                        id: `emergency_${Date.now()}`
                    });
                    
                    // Add warning system message
                    contextBuilder.addMessage({
                        source: 'system',
                        text: '⚠️ WARNING: Unable to load conversation history. You are responding with limited context.',
                        timestamp: new Date().toISOString(),
                        threadTs: threadId
                    });
                } catch (emergencyError) {
                    logger.error(`Failed to add emergency messages: ${emergencyError.message}`);
                }
            }
        }
        
        // Final check before proceeding with LLM
        const finalMessages = contextBuilder.getThreadMessages(threadId);
        logger.info(`Final message count before LLM: ${finalMessages.length}`);
        
        if (finalMessages.length === 0) {
            logger.error(`🚨 CRITICAL ERROR: Still no messages in context after all fallback attempts`);
            logger.info(`Attempting direct context insertion for user message`);
            
            try {
                // Try to create a completely new thread entry
                if (!contextBuilder.threadMessages.has(threadId)) {
                    contextBuilder.threadMessages.set(threadId, []);
                    logger.info(`Created brand new thread entry for ${threadId}`);
                }
                
                // Add original user input to the context directly
                const userText = context?.text || 'Help me please';
                const userId = context?.userId || 'unknown';
                
                // Create multiple emergency messages to ensure at least one gets through
                const emergencyMessages = [
                    // System message explaining the situation
                    {
                        id: `emergency_system_${Date.now()}`,
                        source: 'system',
                        text: `🚨 EMERGENCY: Context loading completely failed for thread ${threadId}. Responding with minimal context.`,
                        timestamp: new Date().toISOString(),
                        threadTs: threadId,
                        type: 'error'
                    },
                    // User message with original text
                    {
                        id: `emergency_user_${Date.now()}`,
                        source: 'user',
                        text: userText,
                        timestamp: new Date().toISOString(),
                        threadTs: threadId,
                        sourceId: userId
                    },
                    // Direct map addition to bypass processing completely
                    {
                        id: `direct_user_${Date.now()}`,
                        source: 'user',
                        text: userText,
                        timestamp: new Date().toISOString(),
                        threadTs: threadId,
                        sourceId: userId
                    }
                ];
                
                // Try multiple approaches to get at least one message into context
                for (const msg of emergencyMessages) {
                    try {
                        // First try the normal addMessage method
                        const added = contextBuilder.addMessage(msg);
                        logger.info(`Added emergency message: ${added.id}`);
                        
                        // Directly add to message maps as a backup
                        contextBuilder.messages.set(msg.id, msg);
                        
                        // Get existing thread messages or create a new array
                        if (!contextBuilder.threadMessages.has(threadId)) {
                            contextBuilder.threadMessages.set(threadId, []);
                        }
                        
                        // Add to thread messages directly
                        const threadMsgs = contextBuilder.threadMessages.get(threadId);
                        threadMsgs.push(msg.id);
                        contextBuilder.threadMessages.set(threadId, threadMsgs);
                        
                        logger.info(`Directly added message ${msg.id} to thread ${threadId}`);
                    } catch (msgError) {
                        logger.error(`Error adding emergency message: ${msgError.message}`);
                    }
                }
                
                // Set metadata to mark this as an emergency context recovery
                contextBuilder.setMetadata(threadId, 'emergencyRecovery', true);
                contextBuilder.setMetadata(threadId, 'originalUserText', userText);
                
                // Final verification
                const verifyMessages = contextBuilder.getThreadMessages(threadId);
                logger.info(`After emergency recovery: thread has ${verifyMessages.length} messages`);
            } catch (emergencyError) {
                logger.error(`Failed emergency context recovery: ${emergencyError.message}`);
                logger.error(emergencyError.stack);
            }
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
                
                // Early finish if message already sent (strict policy)
                if (messagePosted && iteration > 2) {
                    logger.warn(`🛑 Strict policy: Message already sent on iteration ${iteration}, auto-finishing`);
                    
                    // Add a system message explaining the auto-finish
                    contextBuilder.addMessage({
                        source: 'system',
                        text: `🛑 AUTO-FINISH: You've already sent a message to the user. To prevent multiple responses, the system is auto-finishing this request.`,
                        timestamp: new Date().toISOString(),
                        threadTs: threadId
                    });
                    
                    // Auto-finish the request
                    const finishTool = getTool('finishRequest');
                    if (finishTool) {
                        await finishTool({
                            summary: "Auto-finishing to enforce one-message policy",
                            reasoning: "Preventing multiple messages to the same user query"
                        }, getThreadContext(threadId, context));
                    }
                    
                    requestCompleted = true;
                    break;
                }
                
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
                    logger.info(`Already sent ${messagesSent} messages, adding finishRequest reminder`);
                    
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
                        
                        // Auto-finish after iteration 3 if message has been posted
                        logger.info(`Auto-finishing after sending a message and waiting ${iteration-1} iterations`);
                        const finishTool = getTool('finishRequest');
                        if (finishTool) {
                            await finishTool({
                                summary: "Auto-finishing after response completed",
                                reasoning: `Response was sent but finishRequest wasn't called after ${iteration-1} iterations`
                            }, getThreadContext(threadId, context));
                        }
                        requestCompleted = true;
                        break;
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
                        // Check if we already sent a message and should block sending another
                        if (messagePosted && messagesSent >= 1) {
                            logger.warn(`⚠️ Blocking additional postMessage call - message already sent`);
                            
                            // Add a system message explaining why the message was blocked
                            contextBuilder.addMessage({
                                source: 'system',
                                text: `⚠️ BLOCKED: Additional message not sent. You should call finishRequest after posting your response to avoid multiple messages.`,
                                timestamp: new Date().toISOString(),
                                threadTs: threadId
                            });
                            
                            // Auto-finish the request to prevent further attempts
                            logger.info(`Auto-finishing to prevent multiple messages`);
                            const finishTool = getTool('finishRequest');
                            if (finishTool) {
                                await finishTool({
                                    summary: "Auto-finishing to prevent multiple messages",
                                    reasoning: "Multiple postMessage attempts detected"
                                }, getThreadContext(threadId, context));
                            }
                            
                            requestCompleted = true;
                            break;
                        }
                        
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
                                
                                // Store the message text in the context for the LLM to reference
                                const messageText = args.text || '';
                                contextBuilder.addMessage({
                                    source: 'assistant',
                                    text: messageText,
                                    timestamp: new Date().toISOString(),
                                    threadTs: threadId,
                                    originalContent: {
                                        tool: 'postMessage',
                                        parameters: args
                                    },
                                    llmResponse: {
                                        tool: 'postMessage',
                                        parameters: args,
                                        reasoning: args.reasoning
                                    }
                                });
                                
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
        
        // After the final check before proceeding with LLM processing
        // Final check and create guaranteed minimal context
        logger.info(`Final safety check: ensuring minimal context exists`);

        // Always add these minimal messages to ensure context isn't empty
        try {
            // Add a minimal system welcome message
            contextBuilder.addMessage({
                id: `sys_welcome_${Date.now()}`,
                source: 'system',
                text: `This is a conversation in Slack.`,
                timestamp: new Date().toISOString(),
                threadTs: threadId
            });
            
            // If we have context, add the user's message directly
            if (context?.text) {
                contextBuilder.addMessage({
                    id: `user_fallback_${Date.now()}`,
                    source: 'user',
                    text: context.text,
                    timestamp: new Date().toISOString(),
                    threadTs: threadId,
                    sourceId: context?.userId || 'unknown'
                });
            }
            
            logger.info(`Added guaranteed minimal context`);
        } catch (minimalError) {
            logger.error(`Error adding minimal context: ${minimalError.message}`);
        }
        
    } catch (error) {
        // Handle with enhanced error handling
        await handleProcessingError(error, threadId, {
            channelId: getContextBuilder().getChannel(threadId),
            userId: getContextBuilder().getMetadata(threadId, 'context')?.userId
        });
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
 * Loads thread history directly into context using the Slack API
 * @param {string} threadId - Thread ID for context
 * @param {string} threadTs - Thread timestamp for Slack API
 * @param {string} channelId - Channel ID for Slack API
 * @param {number} [limit=10] - Maximum number of messages to load
 * @param {boolean} [isEmergencyLoad=false] - Whether this is an emergency load to recover from a failure
 * @returns {Promise<Object>} Result of the history load
 */
async function loadThreadHistoryIntoContext(threadId, threadTs, channelId, limit = 10, isEmergencyLoad = false) {
    try {
        // Validate required parameters
        if (!threadId || !threadTs || !channelId) {
            throw new Error('Missing required parameters for thread history load');
        }
        
        logger.info(`Loading thread history into context (threadId=${threadId}, channelId=${channelId}, limit=${limit})`);
        
        // Get context builder
        const contextBuilder = getContextBuilder();
        
        // Get the Slack client
        const slackClient = getSlackClient();
        
        // First, check if we already have messages for this thread
        const existingMessages = contextBuilder.getThreadMessages(threadId);
        if (existingMessages && existingMessages.length > 0 && !isEmergencyLoad) {
            logger.info(`Thread already has ${existingMessages.length} messages in context, skipping load`);
            return { 
                messagesRetrieved: 0, 
                alreadyLoaded: true,
                existingMessages: existingMessages.length 
            };
        }
        
        // Parameters for thread replies
        const params = {
            channel: channelId,
            ts: threadTs,
            inclusive: true,
            limit: limit
        };
        
        // Call Slack API to get thread replies
        const result = await slackClient.conversations.replies(params);
        
        if (!result.ok) {
            throw new Error(`Slack API error: ${result.error || 'Unknown error'}`);
        }
        
        // Get messages from the result
        const messages = result.messages || [];
        
        if (messages.length === 0) {
            logger.warn('No messages found in thread');
            return { messagesRetrieved: 0 };
        }
        
        logger.info(`Retrieved ${messages.length} messages from Slack API`);
        
        // Format and add each message to the context
        let addedCount = 0;
        
        for (const message of messages) {
            try {
                // Create a normalized message format
                const normalizedMessage = {
                    source: message.bot_id ? 'assistant' : 'user',
                    originalContent: message,
                    id: `slack_${message.ts}`,
                    timestamp: new Date((message.ts * 1000)).toISOString(),
                    threadTs: threadId,
                    text: message.text || '',
                    sourceId: message.user || message.bot_id,
                    type: 'chat_message',
                    metadata: {
                        channel: channelId,
                        ts: message.ts,
                        user: message.user,
                        bot_id: message.bot_id,
                        thread_ts: message.thread_ts || threadTs
                    }
                };
                
                // If the message has attachments, add them
                if (message.attachments && message.attachments.length > 0) {
                    normalizedMessage.attachments = message.attachments;
                }
                
                // Add the message to the context
                contextBuilder.addMessage(normalizedMessage);
                addedCount++;
            } catch (messageError) {
                logger.warn(`Error processing message ${message.ts}: ${messageError.message}`);
                // Continue with next message
            }
        }
        
        // Verify messages were added
        const messagesAfterLoad = contextBuilder.getThreadMessages(threadId);
        logger.info(`Added ${addedCount} messages to context. Context now has ${messagesAfterLoad.length} messages.`);
        
        return {
            messagesRetrieved: addedCount,
            totalMessages: messages.length,
            success: true
        };
    } catch (error) {
        logger.error(`❌ Error loading thread history: ${error.message}`);
        
        // If this is a Slack API error, add better debugging
        if (error.message.includes('Slack API error')) {
            logger.error('This appears to be a Slack API issue. Check bot permissions and tokens.');
        }
        
        // Try an emergency fallback for critical failures
        if (!isEmergencyLoad) {
            try {
                // Add a system message to indicate the error
                const contextBuilder = getContextBuilder();
                contextBuilder.addMessage({
                    source: 'system',
                    text: `Error loading thread history: ${error.message}. The bot may have incomplete conversation context.`,
                    timestamp: new Date().toISOString(),
                    threadTs: threadId,
                    type: 'error'
                });
                
                // Return partial success
                return {
                    messagesRetrieved: 0,
                    error: error.message,
                    success: false,
                    errorHandled: true
                };
            } catch (fallbackError) {
                logger.error(`Failed to add error message to context: ${fallbackError.message}`);
            }
        }
        
        // Re-throw the error for the caller to handle
        throw error;
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