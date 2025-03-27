// Orchestrates the flow between Slack, LLM, and tools
const { getNextAction } = require('./llmInterface.js');
const tools = require('./tools/index.js');
const { getTool } = tools;
const { logError } = require('./errors.js');
const { getSlackClient } = require('./slackClient.js');
const { getThreadState } = require('./threadState.js');

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

        // Get thread state
        const threadId = context.threadTs || context.channelId;
        const threadState = getThreadState(threadId);
        
        // Add context to thread state
        threadState.setMetadata('context', context);
        
        // Store the conversation context string directly in threadState for easy access
        // This makes sure channel ID is readily available in a consistent format
        const conversationContext = `User:${context.userId}, Channel:${context.channelId}, Thread:${context.threadTs || 'N/A'}`;
        threadState._conversationContext = conversationContext;
        console.log(`--- Conversation Context ---\n${conversationContext}\n---------------------`);
        
        // Add thinking reaction
        try {
            const slackClient = getSlackClient();
            await slackClient.reactions.add({
                channel: context.channelId,
                timestamp: context.timestamp || context.threadTs,
                name: 'hourglass_flowing_sand'
            });
        } catch (reactionError) {
            console.log(`Failed to add reaction: ${reactionError.message}`);
        }
        
        // Process the thread
        await processThread(threadState);

        // Update reaction to checkmark
        try {
            const slackClient = getSlackClient();
            await slackClient.reactions.remove({
                channel: context.channelId,
                timestamp: context.timestamp || context.threadTs,
                name: 'hourglass_flowing_sand'
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
                name: 'hourglass_flowing_sand'
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
async function executeTool(toolName, args, threadState) {
    // Check if we've already executed this exact tool call
    if (threadState.hasExecuted(toolName, args)) {
        console.log(`Tool ${toolName} already executed with these args, skipping`);
        return threadState.getToolResult(toolName, args);
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

        // Pass the entire threadState object to the tool
        // Use the sanitized args with standardized reasoning
        const result = await tool(sanitizedArgs, threadState);
        threadState.recordToolExecution(toolName, sanitizedArgs, result);
        return result;

    } catch (error) {
        console.log(`❌ Tool execution failed: ${error.message}`);
        // Add more detailed error information
        if (error.message.includes('JSON') || error.message.includes('array') || error.message.includes('object')) {
            console.log(`💡 This might be a parameter formatting issue. Check that arrays and objects are correctly formatted.`);
        }
        threadState.recordToolExecution(toolName, args, null, error);
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
async function processThread(threadState) {
    const MAX_ITERATIONS = 10;
    let iteration = 0;

    // Debug log: Print what context is stored in the thread state
    const context = threadState.getMetadata('context');
    
    console.log("\n--- THREAD CONTEXT ---");
    if (context) {
        console.log(`User ID: ${context.userId}`);
        console.log(`Channel: ${context.channelId}`);
        console.log(`Thread TS: ${context.threadTs}`);
        console.log(`User's message: "${context.text}"`);
    } else {
        console.log("⚠️ WARNING: No context found in thread state metadata!");
    }
    console.log("---------------------");

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
                }, threadState);
                
                console.log(`Retrieved ${historyResult.messagesRetrieved || 0} messages from thread history`);
                
                // Record the tool execution so the LLM knows about it
                threadState.recordToolExecution('getThreadHistory', 
                    { threadTs: context.threadTs, limit: 10 }, 
                    historyResult);
            }
        }
    } catch (historyError) {
        console.log(`Failed to get thread history: ${historyError.message}`);
        // Continue even if history fetch fails
    }

    // Initialize thread history tracking if it doesn't exist
    if (!threadState.messages) {
        threadState.messages = [];
    }
    
    // Check if we've already added the user's message to the message history
    const userMessageExists = threadState.messages.some(msg => 
        msg.isUser && msg.timestamp === context.timestamp
    );
    
    // Add the current user message to our message history if not already present
    if (!userMessageExists && context) {
        // Make sure we're using the filtered text (without dev prefix)
        const messageText = context.text || '';
        
        threadState.messages.push({
            text: messageText,
            isUser: true,
            timestamp: context.timestamp,
            threadTs: context.threadTs,
            isParentMessage: !context.isThreadedConversation,
            threadPosition: threadState.messages.length + 1
        });
        console.log("Added user's message to thread history");
    }

    // Track if we've successfully processed the request
    let requestCompleted = false;
    let lastToolExecuted = null;
    let messagePosted = false;
    
    while (iteration < MAX_ITERATIONS && !requestCompleted) {
        iteration++;
        console.log(`\n🔄 Iteration ${iteration}/${MAX_ITERATIONS}`);

        try {
            // Get next action from LLM
            const llmResult = await getNextAction(threadState);
            
            // Check for tool calls
            const { toolCalls } = llmResult;
            if (!toolCalls?.length) {
                console.log("No tool calls found in LLM response");
                break;
            }

            // Execute the first tool call
            const { tool: toolName, parameters: args } = toolCalls[0];
            lastToolExecuted = toolName;
            
            // Execute the tool
            const result = await executeTool(toolName, args, threadState);

            // If the tool was finishRequest, we're done
            if (toolName === 'finishRequest') {
                requestCompleted = true;
                console.log("Request finished with finishRequest tool");
                break;
            }
            
            // Track message posting
            if (toolName === 'postMessage' || toolName === 'createButtonMessage') {
                messagePosted = true;
                
                // Create a record of this message for future context
                const messageRecord = {
                    text: args.text || (args.blocks ? "Message with blocks content" : "Message with no text content"),
                    isUser: false,
                    timestamp: result.ts || result.messageTs || new Date().toISOString(),
                    threadTs: context?.threadTs || result.threadTs,
                    fromTool: true,
                    toolName: toolName,
                    requestId: Date.now().toString(),
                    threadPosition: threadState.messages ? threadState.messages.length + 1 : 1
                };
                
                // If there are attachments, save the content in a more descriptive way
                if (args.attachments || args.color) {
                    messageRecord.hasAttachments = true;
                    
                    // Extract actual content from attachments
                    if (args.attachments && args.attachments.length > 0) {
                        // Try to extract text from blocks inside attachments
                        const attachmentBlocks = args.attachments[0].blocks || [];
                        const extractedTexts = [];
                        
                        // Recursively extract text from blocks
                        function extractTextFromBlock(block) {
                            if (!block) return null;
                            
                            // Direct text in a block
                            if (block.text?.text) {
                                return block.text.text;
                            }
                            // Section block
                            else if (block.type === 'section') {
                                if (block.text?.text) {
                                    return block.text.text;
                                }
                            }
                            // Context block with elements
                            else if (block.type === 'context' && Array.isArray(block.elements)) {
                                return block.elements
                                    .map(element => element.text || null)
                                    .filter(Boolean)
                                    .join(" ");
                            }
                            // Header block
                            else if (block.type === 'header' && block.text?.text) {
                                return `*${block.text.text}*`;
                            }
                            
                            return null;
                        }
                        
                        // Process each block
                        for (const block of attachmentBlocks) {
                            const extractedText = extractTextFromBlock(block);
                            if (extractedText) {
                                extractedTexts.push(extractedText);
                            }
                        }
                        
                        if (extractedTexts.length > 0) {
                            // Use the actual content from blocks
                            messageRecord.text = extractedTexts.join("\n");
                        }
                    }
                    
                    // Include the first part of the text as description
                    if (messageRecord.text) {
                        messageRecord.description = `Sent formatted message: "${messageRecord.text.substring(0, 100)}${messageRecord.text.length > 100 ? '...' : ''}"`;
                    } else {
                        messageRecord.description = "Sent message with attachments but couldn't extract text content";
                    }
                }
                
                // Add the message to our thread history
                threadState.messages.push(messageRecord);
                
                console.log(`Added ${toolName} result to thread history for future context`);
                
                // Add a brief pause to ensure message is fully processed
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // If this is a button message, add a special note to help the LLM understand
                // what was created
                if (toolName === 'createButtonMessage') {
                    try {
                        // Safely extract button text descriptions
                        let buttonDescriptions = "Created interactive buttons";
                        
                        // Check if args has buttons either at top level or in parameters
                        const buttonsArray = args.buttons || (args.parameters && args.parameters.buttons);
                        
                        // Safe validation before attempting to process
                        if (buttonsArray) {
                            // Safely handle both array and string formats
                            let buttons = buttonsArray;
                            
                            // If it's a JSON string, try to parse it
                            if (typeof buttons === 'string') {
                                try {
                                    buttons = JSON.parse(buttons);
                                    console.log('Successfully parsed buttons from JSON string');
                                } catch (err) {
                                    console.log(`Couldn't parse buttons string: ${err.message}`);
                                    buttons = null;
                                }
                            }
                            
                            // Only proceed if buttons is a valid array now
                            if (Array.isArray(buttons) && buttons.length > 0) {
                                // Extract text safely from each button
                                const buttonTexts = buttons
                                    .filter(b => b && typeof b === 'object')
                                    .map(b => {
                                        // Handle various button text formats
                                        if (b.text?.text) return b.text.text; // Slack block format
                                        if (b.text) return b.text;           // Simple format
                                        if (b.value) return b.value;         // Fallback to value
                                        return 'Unnamed button';             // Last resort
                                    });
                                
                                if (buttonTexts.length > 0) {
                                    buttonDescriptions += ": " + buttonTexts.join(', ');
                                }
                            }
                        }
                        
                        // Add a clear entry showing what buttons were created
                        const buttonDescription = {
                            text: buttonDescriptions,
                            isUser: false,
                            isSystemNote: true,
                            timestamp: new Date().toISOString(),
                            threadTs: context?.threadTs,
                            fromTool: true,
                            toolName: "system_note",
                            threadPosition: threadState.messages.length + 1
                        };
                        
                        // Add this description to thread history
                        threadState.messages.push(buttonDescription);
                        
                        console.log("Added button description to thread history");
                    } catch (error) {
                        console.log(`Error creating button description: ${error.message}`);
                        // Continue even if button description fails - this is not critical
                    }
                }
            }
            
            // Auto-complete the request after message was posted
            if (!requestCompleted && messagePosted && iteration > 1) {
                console.log("Message posted but no finishRequest called - auto-completing request immediately");

                try {
                    // Call finishRequest implicitly
                    const finishTool = getTool('finishRequest');
                    if (finishTool) {
                        await finishTool({
                            summary: "Auto-completed after message was posted",
                            reasoning: "Auto-completion to end request after message posted"
                        }, threadState);
                        console.log("Request auto-completed with implicit finishRequest");
                        requestCompleted = true;
                    }
                } catch (autoCompleteError) {
                    console.log(`Failed to auto-complete request: ${autoCompleteError.message}`);
                }
            }

        } catch (error) {
            console.log(`Error in process loop: ${error.message}`);
            
            // Instead of sending a hardcoded error message, add the error to thread state
            // and let the LLM decide how to handle it
            try {
                const context = threadState.getMetadata('context');
                
                if (context && context.channelId) {
                    // Format the error for the LLM
                    const { formatErrorForLLM } = require('./errors.js');
                    const formattedError = formatErrorForLLM(error);
                    
                    // Store the error in thread state as a failed tool execution
                    // This will appear naturally in the conversation flow
                    threadState.recordToolExecution('error_handler', 
                        { 
                            source: error.source || 'processThread',
                            operation: error.operation || 'unknown'
                        }, 
                        formattedError,
                        error);
                    
                    // Continue processing with the LLM to let it handle the error
                    const llmResult = await getNextAction(threadState);
                    
                    // Check for tool calls
                    const { toolCalls } = llmResult;
                    if (toolCalls?.length) {
                        // Execute the tool call from the LLM's error handling
                        const { tool: toolName, parameters: args } = toolCalls[0];
                        await executeTool(toolName, args, threadState);
                        
                        // If the tool was finishRequest, we're done
                        if (toolName === 'finishRequest') {
                            requestCompleted = true;
                            break;
                        }
                    }
                }
            } catch (errorHandlingError) {
                console.log(`Failed to handle error via LLM: ${errorHandlingError.message}`);
                // Log the original error and the error handling error
                logError('Error handling failed', errorHandlingError, { originalError: error });
            }
            
            break;
        }
    }

    // Auto-complete the request if we've reached the iteration limit
    if (!requestCompleted && iteration >= MAX_ITERATIONS) {
        console.log("Reached maximum iterations without explicit finishRequest - auto-completing");
        
        try {
            // Call finishRequest implicitly
            const finishTool = getTool('finishRequest');
            if (finishTool) {
                await finishTool({
                    summary: "Auto-completed due to iteration limit",
                    reasoning: "Auto-completion due to iteration limit"
                }, threadState);
                
                console.log("Request auto-completed due to iteration limit");
                
                // Add a clear system note about auto-completion due to iteration limit
                if (threadState.messages) {
                    threadState.messages.push({
                        text: "Request auto-completed after reaching maximum iterations",
                        isUser: false,
                        isSystemNote: true,
                        timestamp: new Date().toISOString(),
                        threadTs: context?.threadTs,
                        fromTool: true,
                        toolName: "system_note",
                        threadPosition: threadState.messages.length + 1
                    });
                }
            }
        } catch (finishError) {
            console.log(`Error auto-completing request: ${finishError.message}`);
            // Continue even if auto-completion fails
        }
    }
}

/**
 * Handle a button click event from Slack
 * @param {Object} payload - The button click payload from Slack
 * @returns {Promise<void>}
 */
async function handleButtonClick(payload) {
  // Call the new dedicated function to process button interactions
  await processButtonInteraction(payload);
}

/**
 * Process button interaction event
 * @param {Object} payload - The button click payload from Slack
 * @returns {Promise<void>}
 */
async function processButtonInteraction(payload) {
  try {
    console.log(`\nAction: ${payload.actions[0].action_id} | Value: ${payload.actions[0].value} | User: ${payload.user.id} | Channel: ${payload.channel.id}`);
    
    console.log(`\n👆 BUTTON CLICK`);
    console.log(`User: ${payload.user.id} | Action: ${payload.actions[0].action_id}`);
    console.log(`--------------------------------`);
    
    // Extract key information
    const actionId = payload.actions[0].action_id;
    const actionValue = payload.actions[0].value;
    const buttonText = payload.actions[0].text?.text || actionValue;
    const userId = payload.user.id;
    const channelId = payload.channel.id;
    const threadTs = payload.message.thread_ts || payload.container.message_ts;
    const messageTs = payload.container.message_ts;
    
    // Create thread ID (consistent with our other code)
    const threadId = threadTs || channelId;
    
    // UPDATED: Get thread state directly using the imported function
    const threadState = getThreadState(threadId);
    
    // UPDATED: Check if we can find button metadata in the thread state
    let buttonMetadata = {};
    
    if (threadState.buttonMetadataMap && threadState.buttonMetadataMap[actionId]) {
      buttonMetadata = threadState.buttonMetadataMap[actionId];
      console.log(`Found button metadata for exact match on ${actionId}`);
    } else {
      // Try to find a partial match
      for (const key in threadState.buttonMetadataMap || {}) {
        if (key.includes(actionId) || actionId.includes(key)) {
          buttonMetadata = threadState.buttonMetadataMap[key];
          console.log(`Found button metadata for partial match ${key} <-> ${actionId}`);
          break;
        }
      }
    }
    
    // Add a loading reaction immediately to provide visual feedback
    try {
      const slackClient = getSlackClient();
      // Add a temporary loading message to indicate processing
      await slackClient.reactions.add({
        channel: channelId,
        timestamp: messageTs,
        name: 'hourglass_flowing_sand' // Loading indicator emoji
      });
    } catch (reactionError) {
      // Non-critical error, just log it
      console.log(`⚠️ Could not add loading reaction: ${reactionError.message}`);
    }
    
    // Build context object with all the information
    const context = {
      userId,
      channelId,
      threadTs,
      messageTs,
      actionId,
      actionValue,
      buttonText,
      isButtonClick: true
    };
    
    // Add the button metadata if found
    if (buttonMetadata) {
      Object.assign(context, buttonMetadata);
    }
    
    // Store the context in thread state
    threadState.setMetadata('context', context);
    
    // Create a simulation of a user message with the button click info
    const buttonClickMessage = {
      user: userId,
      text: buttonText, // Use only the button text, not "Clicked: buttonText"
      isUser: true,
      isButtonClick: true, // Mark as button click
      timestamp: Date.now(),
      threadTs
    };
    
    // Add the button click to the thread history
    if (typeof threadState.addMessage === 'function') {
      threadState.addMessage(buttonClickMessage);
      console.log(`Added user's message to thread history using addMessage()`);
    } else {
      // Initialize the messages array if it doesn't exist
      if (!Array.isArray(threadState.messages)) {
        threadState.messages = [];
      }
      
      // Add the message directly to the messages array instead
      threadState.messages.push(buttonClickMessage);
      console.log(`Added user's message to thread history by pushing to messages array`);
    }
    
    // Process the button click
    await processThread(threadState);
  } catch (error) {
    console.error(`Error handling button interaction:`, error);
    // Attempt to send error message if possible
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

module.exports = {
    handleIncomingSlackMessage,
    handleButtonClick,
    executeTool,
    processThread,
    processButtonInteraction
};