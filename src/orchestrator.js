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
 * Execute a tool
 * @param {string} toolName - Name of the tool to execute
 * @param {Object} args - Tool arguments
 * @param {string} threadId - Thread ID
 * @returns {Promise<Object>} - Tool execution result
 */
async function executeTool(toolName, args, threadId) {
  try {
    const tools = require('./tools');
    
    // Get context
    const context = getThreadContext(threadId);
    
    // Get tool execution count for this thread
    const contextBuilder = getContextBuilder();
    const toolExecutions = contextBuilder.getToolExecutionHistory(threadId);
    
    // Count consecutive calls to this tool
    const sameTool = toolExecutions.filter(te => te.toolName === toolName);
    const callCount = sameTool.length;
    
    // Count errors in recent executions of this tool
    const errors = sameTool.filter(te => te.error).length;
    
    // Special handling for specific tools
    switch(toolName) {
      case 'getThreadHistory':
        logger.info(`Handling getThreadHistory with special handler (call #${callCount + 1})`);
        return await handleGetThreadHistory(args, threadId, context, callCount, errors);
        
      case 'postMessage':
        // Ensure reasoning gets stored in metadata
        args.metadata = args.metadata || {};
        args.metadata.reasoning = args.reasoning || "No reasoning provided";
        break;
        
      case 'finishRequest':
        // Track completion for analytics
        args.metadata = args.metadata || {};
        args.metadata.completionTime = new Date().toISOString();
        args.metadata.toolCalls = toolExecutions.length;
        break;
    }
    
    // Get the tool function from the registry
    const toolFunction = tools.getTool(toolName);
    
    // Execute the appropriate tool
    if (!toolFunction) {
      logger.error(`Tool not found in registry: ${toolName}`);
      throw new Error(`Tool not found: ${toolName}`);
    }
    
    logger.info(`Executing tool: ${toolName}`);
    const result = await toolFunction(args, { threadTs: threadId, ...context });
    
    // Record the execution in the context
    contextBuilder.recordToolExecution(threadId, toolName, args, result);
    
    return result;
  } catch (error) {
    logger.error(`Error executing tool ${toolName}: ${error.message}`);
    
    // Record the error in the context
    const contextBuilder = getContextBuilder();
    contextBuilder.recordToolExecution(threadId, toolName, args, null, error);
    
    // Rethrow for upstream handling
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
        
        // DEBUG: Log button selection status to help track the loop issue
        if (isButtonSelection) {
            logger.info(`🔘 Processing as button selection for thread ${threadId}`);
        } else {
            // CRITICAL FIX: If this is NOT a button selection, it's a fresh user request
            // Clear any confusing previous context that might contain "Selection made" messages
            logger.info(`🧹 Fresh request detected - cleaning up any previous "Selection made" messages`);
            
            const messages = contextBuilder.getThreadMessages(threadId) || [];
            const cleanedMessages = messages.filter(msg => {
                // Remove messages that contain "Selection made" text as they pollute the context
                return !(msg.text && msg.text.includes('Selection made'));
            });
            
            if (cleanedMessages.length !== messages.length) {
                logger.info(`🧹 Removed ${messages.length - cleanedMessages.length} "Selection made" messages from context`);
                // Update the thread messages
                contextBuilder.threadMessages.set(threadId, cleanedMessages);
            }
        }
        
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
                    logger.info(`Already sent ${messagesSent} messages, checking if we should wait for user interaction`);
                    
                    // CRITICAL FIX: Check if the last message contained buttons
                    // If so, we should NOT auto-finish - we should wait for user interaction
                    const lastMessages = contextBuilder.getThreadMessages(threadId) || [];
                    const lastBotMessage = lastMessages
                        .filter(msg => msg.source === 'assistant' || msg.type === 'bot_message')
                        .pop();
                    
                    const hasButtons = lastBotMessage && lastBotMessage.text && 
                        (lastBotMessage.text.includes('#buttons:') || lastBotMessage.text.includes('buttons:'));
                    
                    if (hasButtons) {
                        logger.info(`🔘 Last message contained buttons - NOT auto-finishing, waiting for user interaction`);
                        
                        // Don't auto-finish if we posted buttons - wait for user interaction
                        // Just break out of the loop to wait for button clicks
                        requestCompleted = true;
                        break;
                    } else {
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
                            
                            // Auto-finish after iteration 3 if message has been posted (but no buttons)
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
                                                    // More intelligent loop detection - only consider it a loop if it's really excessive
                        if (consecutiveSimilarOperations >= 5) {
                            logger.warn(`⚠️ Potential loop detected: ${consecutiveSimilarOperations} consecutive ${toolName} calls`);
                            
                            // For getThreadHistory, allow more attempts as it's often needed for context
                            if (toolName === 'getThreadHistory' && consecutiveSimilarOperations < 7) {
                                logger.info(`Allowing additional getThreadHistory calls - may be needed for context building`);
                            } else {
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
                
                // Special handling for button selections - ONLY auto-finish if this was a response to a button click
                if (isButtonSelection && buttonResponses === 0 && messagePosted) {
                    // Only auto-finish if this was actually a response to a button click
                    // Check if we have a recent button click in the context
                    const recentMessages = contextBuilder.getThreadMessages(threadId) || [];
                    const hasRecentButtonClick = recentMessages.some(msg => 
                        msg.type === 'button_click' && 
                        (Date.now() - new Date(msg.timestamp).getTime()) < 30000 // Within last 30 seconds
                    );
                    
                    if (hasRecentButtonClick) {
                        // This is a response to a button click - auto-finish
                        logger.info('Button selection response sent (responding to button click), auto-finishing request');
                        
                        // CRITICAL FIX: Clear the button selection flag to prevent loops
                        contextBuilder.setMetadata(threadId, 'isButtonSelection', false);
                        logger.info('Cleared isButtonSelection flag to prevent future loops');
                        
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
                    } else {
                        // This is just posting buttons initially - don't auto-finish yet
                        logger.info('Posted buttons but no recent button click - NOT auto-finishing, waiting for user interaction');
                    }
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
 * Get thread context for tools
 * @param {string} threadId - Thread ID
 * @returns {Object} - Thread context
 */
function getThreadContext(threadId) {
  const contextBuilder = getContextBuilder();
  
  // Create an object with thread-specific context for the tool
  return {
    threadId,
    channelId: contextBuilder.getChannel(threadId),
    threadTs: contextBuilder.getThreadTs(threadId),
    isDirectMessage: contextBuilder.getMetadata(threadId, 'isDirectMessage') || false,
    userInfo: contextBuilder.getMetadata(threadId, 'userInfo') || {},
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
}

/**
 * Handle getThreadHistory tool calls
 * @param {Object} args - Tool call arguments
 * @param {string} threadId - Thread ID
 * @param {Object} context - Thread context
 * @param {number} callCount - Count of tool calls
 * @param {number} errorCount - Count of errors
 * @returns {Promise<Object>} - Thread history result
 */
async function handleGetThreadHistory(args, threadId, context, callCount, errorCount) {
  try {
    logger.info(`🧵 Getting thread history for ${threadId}`);
    
    // Extract parameters
    const limit = args.limit || 20;
    const ascending = args.ascending === true;
    const forceRefresh = args.forceRefresh === true;
    
    // Get thread info from context
    const channelId = context.channelId || threadId;
    const threadTs = context.threadTs || threadId;
    
    // Check for excessive calls but be more permissive for legitimate use cases
    const MAX_CONSECUTIVE_CALLS = 6; // Increased from 3 to 6
    if (callCount > MAX_CONSECUTIVE_CALLS && !forceRefresh) {
      logger.warn(`⚠️ Detected potential loop in getThreadHistory calls (${callCount} consecutive calls)`);
      
      // Return a warning but still proceed with the history retrieval
      logger.info(`Proceeding with getThreadHistory despite ${callCount} calls - legitimate use case possible`);
    }
    
    // Get context builder
    const { getThreadContextBuilder } = require('./threadContextBuilder.js');
    const threadContextBuilder = getThreadContextBuilder();
    
    // Clear cache if force refresh is requested
    if (forceRefresh) {
      logger.info(`Forcing refresh of thread history for ${threadId}`);
      threadContextBuilder.clearCache(threadTs, channelId);
    }
    
    // Build context to get thread history
    const threadInfo = await threadContextBuilder._getThreadInfo(threadTs, channelId);
    
    // Format messages for presentation to the LLM
    const formattedMessages = threadInfo.messages.map((msg, index) => {
      // Determine message type (user, bot, system)
      const isUser = !(msg.bot_id || msg.subtype === 'bot_message' || msg.user === process.env.SLACK_BOT_USER_ID);
      const isSystem = msg.subtype && ['channel_join', 'channel_leave', 'channel_purpose', 'channel_topic'].includes(msg.subtype);
      
      // Format user info
      const userIdentifier = isUser ? `<@${msg.user || 'unknown'}>` : 'Aya';
      
      // Convert timestamp to readable format
      const timestamp = msg.ts ? new Date(parseInt(msg.ts) * 1000).toLocaleString() : 'Unknown time';
      
      // Prefix for each message
      const prefix = `[${index}] ${isUser ? '👤' : isSystem ? '🔄' : '🤖'} `;
      
      // Handle attachments/blocks - simplify for presentation
      let attachmentText = '';
      if (msg.attachments && msg.attachments.length > 0) {
        attachmentText = msg.attachments.map(att => 
          `\n    📎 ${att.title || 'Attachment'}: ${att.text || att.fallback || 'No description'}`
        ).join('');
      }
      
      // Format final message text
      return `${prefix}${userIdentifier} (${timestamp}):\n${msg.text || ''}${attachmentText}`;
    });
    
    // Generate formatted history text
    const historyHeader = `Thread History in ${threadInfo.isThread ? 'Thread' : 'Direct Message'} (${formattedMessages.length} messages):\n`;
    const formattedHistoryText = historyHeader + formattedMessages.join('\n\n');
    
    // Create indexing info
    const indexInfo = {
      indexRange: `0-${formattedMessages.length - 1}`,
      messageCount: formattedMessages.length,
      missingMessages: 0
    };
    
    // Create thread stats
    const threadStats = {
      totalMessagesInThread: formattedMessages.length,
      remainingMessages: 0,
      parentMessageRetrieved: threadInfo.parentMessage !== null
    };
    
    // Return formatted result
    logger.info(`✅ Retrieved ${formattedMessages.length} messages from thread history`);
    
    return {
      messagesRetrieved: formattedMessages.length,
      messages: formattedMessages,
      formattedHistoryText,
      threadStats,
      indexInfo,
      fromCache: !forceRefresh,
      cachedAt: forceRefresh ? null : new Date().toISOString()
    };
  } catch (error) {
    logger.error(`❌ Error getting thread history: ${error.message}`);
    errorCount = (errorCount || 0) + 1;
    
    // After multiple failures, fall back to a simpler approach
    if (errorCount > 3) {
      logger.warn(`Multiple failures getting thread history, using emergency fallback`);
      return {
        error: true,
        messagesRetrieved: 0,
        messages: ["Failed to retrieve thread history."],
        threadStats: {
          totalMessagesInThread: 0,
          remainingMessages: 0
        },
        recommendation: "Please try a different approach or ask the user for more context."
      };
    }
    
    // Try the legacy approach as fallback
    try {
      logger.info(`Attempting legacy thread history loading...`);
      return await loadThreadHistoryIntoContext(threadId, context.threadTs, context.channelId, args.limit || 10, true);
    } catch (fallbackError) {
      logger.error(`Legacy thread history loading also failed: ${fallbackError.message}`);
      return { 
        error: true, 
        message: error.message,
        fallbackError: fallbackError.message
      };
    }
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
    
    // CRITICAL FIX: Set temporary button selection flag that will be cleared after processing
    // This prevents the flag from persisting and causing loops in subsequent interactions
    contextBuilder.setMetadata(threadId, 'isButtonSelection', true);
    
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