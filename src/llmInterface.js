// Interface for communicating with the LLM
const { LLM_API_KEY, LLM_API_URL, LLM_MODEL } = require('./config.js');
const { logError, formatErrorForLLM } = require('./errors.js');
const fetch = require('node-fetch');
const { getToolsForLLM } = require('./tools');
const { getContextBuilder } = require('./contextBuilder.js');
const { readFileSync } = require('fs');
const path = require('path');
const { callOpenAI } = require('./openai.js');
const logger = require('./toolUtils/logger.js');
const llmDebugLogger = require('./toolUtils/llmDebugLogger.js');
const ayaPrompts = require('./prompts/aya.js');

// Turn on debug context logging in non-production environments
if (process.env.NODE_ENV !== 'production' && process.env.DEBUG_CONTEXT !== 'false') {
  process.env.DEBUG_CONTEXT = 'true';
  console.log("Context debugging enabled by default in non-production environments");
}

// Also enable LLM debug logging in non-production environments
if (process.env.NODE_ENV !== 'production' && process.env.DEBUG_LLM !== 'false') {
  process.env.DEBUG_LLM = 'true';
}

// Technical constants for tool behavior and response formatting
// These are NOT personality related but specific to technical implementation
const TOOL_CALL_FORMAT = ayaPrompts.TECHNICAL_GUIDELINES.toolCallFormat;

// Examples of correct and incorrect formats for parameter structure
const PARAMETER_STRUCTURE_EXAMPLES = ayaPrompts.TECHNICAL_GUIDELINES.parameterExamples;

// Technical formatting requirements for tool calls
const FORMAT_REQUIREMENTS = ayaPrompts.TECHNICAL_GUIDELINES.formatRequirements;

// Critical workflow for tool execution
const REMEMBER_CRITICAL = ayaPrompts.TECHNICAL_GUIDELINES.workflowRules;

// Simple GPT token estimator
const GPT_TOKENS_PER_CHAR = 0.25; // Rough estimate for English text

/**
 * Token budget constants
 */
const TOKEN_BUDGET = {
  MAX_TOTAL: 4000,  // Target max tokens
  MIN_USER_MESSAGES: 800  // Ensure some space for user messages
};

/**
 * Estimates token count for a text
 */
function estimateTokenCount(text) {
  if (!text) return 0;
  return Math.ceil(text.length * GPT_TOKENS_PER_CHAR);
}

/**
 * Ensures context stays within token limits
 */
function ensureContextWithinLimits(context) {
  // Add fallback for empty context
  if (!context || !Array.isArray(context) || context.length === 0) {
    logger.warn('⚠️ Empty context detected, adding fallback system message');
    return [{
      role: "system",
      content: "Note: The conversation context is empty. This might indicate an issue with context loading. Please respond appropriately and call finishRequest after your response."
    }];
  }
  
  // Clone the context
  const result = JSON.parse(JSON.stringify(context));
  
  // Get total token estimate
  const totalTokens = estimateTokenCount(JSON.stringify(result));
  
  // If we're within limits, just return the context as is
  if (totalTokens <= TOKEN_BUDGET.MAX_TOTAL) {
    return result;
  }
  
  logger.info(`Context size (${totalTokens} tokens) exceeds target (${TOKEN_BUDGET.MAX_TOTAL}). Optimizing...`);
  
  // If we have messages, keep only the most recent ones
  if (result.messages && result.messages.length > 0) {
    // Always keep the first message (system message) 
    const systemMessages = result.messages.filter(m => m.role === 'system');
    
    // Sort user and assistant messages by recency
    const otherMessages = result.messages
      .filter(m => m.role !== 'system')
      .sort((a, b) => {
        // Try to extract timestamps if available
        const timeA = a.timestamp || a.ts || 0;
        const timeB = b.timestamp || b.ts || 0;
        return timeB - timeA; // Sort descending (newest first)
      });
    
    // Keep reducing context until we're under the limit
    while (estimateTokenCount(JSON.stringify(result)) > TOKEN_BUDGET.MAX_TOTAL && otherMessages.length > 0) {
      // Remove the oldest non-system message
      otherMessages.pop();
      
      // Rebuild the messages array
      result.messages = [...systemMessages, ...otherMessages];
    }
    
    // Add a note about truncation
    if (otherMessages.length < context.messages.length - systemMessages.length) {
      result.messages.push({
        role: 'system',
        content: `Note: Some older messages were omitted due to context length limits.`
      });
    }
  }
  
  // Final size after optimization
  const finalTokens = estimateTokenCount(JSON.stringify(result));
  logger.info(`Context optimized to ${finalTokens} tokens`);
  
  return result;
}

// Load the system prompt
const systemPrompt = ayaPrompts.getCompleteSystemPrompt();

/**
 * Get the system message for the LLM
 * @param {Object} context - Context for the conversation
 * @returns {string} - System message
 */
function getSystemMessage(context) {
  // The system message is now derived primarily from the system_prompt_updated.md file
  // The context is added to provide information about the current channel
  const contextInfo = context ? 
    `\n\nYou are currently in a conversation with a user in a Slack channel (${context.channelId}).` : 
    `\n\nYou are having a chat with a user in Slack.`;
  
  // Add technical appendix with critical formatting requirements
  const technicalAppendix = ayaPrompts.generateTechnicalAppendix();
  
  return systemPrompt + contextInfo + technicalAppendix;
}

/**
 * Get the next action from the LLM
 * @param {string} threadId The thread ID to get the next action for
 * @param {Object} options Additional options
 * @param {Object} options.additionalSystemMessage Optional additional system message to include
 * @returns {Promise<{toolCalls: Array<{tool: string, parameters: Object}>}>}
 */
async function getNextAction(threadId, options = {}) {
    logger.info(`🧠 Getting next action from LLM for thread: ${threadId}`);
    
    // Get context builder
    const contextBuilder = getContextBuilder();
    
    // Build the prompt with thread-specific information
    const jsonContext = buildPrompt(threadId);
    
    // Check if context is empty and log a warning
    if (!jsonContext || !Array.isArray(jsonContext) || jsonContext.length === 0) {
        logger.error(`⚠️ ERROR: Empty context for thread ${threadId}. This is likely an initialization issue.`);
    }
    
    // Ensure context is within token limits
    const optimizedContext = ensureContextWithinLimits(jsonContext);
    
    // Verify that we have a non-empty context after optimization
    if (!optimizedContext || !Array.isArray(optimizedContext) || optimizedContext.length === 0) {
        logger.error(`⚠️ CRITICAL ERROR: Context is still empty after optimization for thread ${threadId}`);
        // Add a fallback context with an error message
        const fallbackContext = [{
            role: "system",
            content: "ERROR: Failed to build conversation context. Please respond with a generic message and call finishRequest."
        }];
        logger.info("Using fallback error context");
        return {
            toolCalls: [{
                tool: "postMessage",
                parameters: {
                    text: "#header: I'm having trouble processing your request\n\n#section: There was an error retrieving the conversation history. Let me help you with something else.",
                    color: "#E01E5A",
                    reasoning: "Responding with error message due to context failure"
                },
                reasoning: "Context build failure fallback response"
            }]
        };
    }
    
    // Format the JSON context for OpenAI's message format
    const messages = [
        {
            role: "system",
            content: systemPrompt
        }
    ];
    
    // Add additional system message if provided
    if (options.additionalSystemMessage) {
        messages.push(options.additionalSystemMessage);
    }
    
    // Instead of wrapping context as a JSON string in a single message,
    // add each context message as a separate message in the OpenAI format
    optimizedContext.forEach(contextMsg => {
        // Special handling for user messages with content objects
        if (contextMsg.role === 'user' && typeof contextMsg.content === 'object' && contextMsg.content.text) {
            // Convert user message content object to plain text
            // OpenAI expects a string for content, not an object
            messages.push({
                role: 'user',
                content: contextMsg.content.text
            });
            logger.info(`Converting user message object to text: ${contextMsg.content.text}`);
        } else {
            messages.push({
                role: contextMsg.role,
                content: contextMsg.content
            });
        }
    });
    
    // Log detailed information about messages being sent
    logger.info(`Sending ${messages.length} messages to LLM:`);
    messages.forEach((msg, idx) => {
        if (msg.role === 'user' && typeof msg.content === 'object') {
            logger.info(`Message ${idx} (${msg.role}): ${JSON.stringify(msg.content)}`);
        } else {
            const contentPreview = typeof msg.content === 'string' 
                ? (msg.content.length > 50 ? msg.content.substring(0, 50) + '...' : msg.content)
                : JSON.stringify(msg.content).substring(0, 50) + '...';
            logger.info(`Message ${idx} (${msg.role}): ${contentPreview}`);
        }
    });
    
    // Log the formatted context for debugging using the dedicated formatter
    try {
        const contextFormatter = require('./toolUtils/contextFormatter.js');
        contextFormatter.logFormattedContext(optimizedContext, 'SENDING TO LLM');
    } catch (error) {
        logger.error('Error formatting context for debug output:', error);
    }
    
    // Get tools directly from the tools module - they are already in the correct format
    const availableTools = getToolsForLLM();
    logger.info(`Providing ${availableTools.length} tools to OpenAI API`);
    
    // Call OpenAI with the tools
    const response = await callOpenAI({
        messages,
        tools: availableTools,
        tool_choice: "required"  // Let the model decide whether to use tools
    });
    
    if (!response || !response.choices || response.choices.length === 0) {
        throw new Error("Invalid response from OpenAI");
    }
    
    // Get the message from the response
    const message = response.choices[0].message;
    
    // Add the LLM's thinking to the context if content is present
    if (message.content) {
        contextBuilder.addMessage({
            source: 'llm_thinking',
            originalContent: message,
            id: `llm_${Date.now()}`,
            timestamp: new Date().toISOString(),
            threadTs: threadId,
            text: message.content,
            type: 'thinking',
            metadata: {
                model: response.model,
                role: 'assistant'
            }
        });
    }
    
    // Format the response for our orchestrator
    let toolCalls = [];
    
    // Check if the message has tool_calls
    if (message.tool_calls && message.tool_calls.length > 0) {
        logger.info(`LLM wants to call ${message.tool_calls.length} tools`);
        
        // Process each tool call
        toolCalls = message.tool_calls.map(toolCall => {
            try {
                // Only process function-type tool calls
                if (toolCall.type !== 'function') {
                    logger.info(`Skipping non-function tool call of type: ${toolCall.type}`);
                    return null;
                }
                
                // Get the function name - this is the name of our tool
                const functionName = toolCall.function.name;
                logger.info(`Processing function call: ${functionName}`);
                
                // Parse the arguments (they come as a JSON string)
                let args;
                try {
                    args = JSON.parse(toolCall.function.arguments);
                } catch (parseError) {
                    logger.warn(`Error parsing tool arguments: ${parseError.message}`);
                    
                    // Try to clean up any formatting issues before parsing again
                    const cleanedArgs = toolCall.function.arguments
                        .replace(/\\n/g, '\n')  // Handle escaped newlines
                        .replace(/\n/g, ' ')    // Replace actual newlines with spaces
                        .replace(/\t/g, ' ')    // Replace tabs with spaces
                        .replace(/\s+/g, ' ')   // Replace multiple spaces with a single space
                        .trim();
                    
                    try {
                        args = JSON.parse(cleanedArgs);
                        logger.info("Successfully parsed arguments after cleanup");
                    } catch (secondError) {
                        // If still failing, create a minimal valid object with the required reasoning
                        logger.warn(`Could not parse arguments even after cleanup: ${secondError.message}`);
                        args = {
                            __parsing_error: true,
                            __raw_arguments: toolCall.function.arguments,
                            error: parseError.message,
                            reasoning: "Error parsing tool arguments"
                        };
                    }
                }
                
                // Format the tool call for our orchestrator
                // Keep the reasoning in the parameters for backward compatibility 
                // with tools that expect it there
                return {
                    tool: functionName,
                    parameters: args,
                    reasoning: args.reasoning || "No explicit reasoning provided"
                };
            } catch (error) {
                logger.warn(`Error handling tool call: ${error.message}`);
                // Return null for failed processing
                return null;
            }
        }).filter(call => call !== null); // Remove any failed tool calls
    } else if (message.content && message.content.trim()) {
        // If no tool calls but there is content, create a postMessage tool call
        logger.info("No tool calls, creating implicit postMessage from content");
        toolCalls = [{
            tool: "postMessage",
            parameters: {
                text: message.content.trim(),
                reasoning: "Implicit response converted to postMessage"
            },
            reasoning: "Implicit response converted to postMessage"
        }];
    } else {
        logger.info("No content or tool calls in response");
        // Create a default tool call when no response is provided
        
        // First, add a system message to inform the LLM about the empty response issue
        contextBuilder.addMessage({
            source: 'system',
            id: `empty_response_${Date.now()}`,
            timestamp: new Date().toISOString(),
            threadTs: threadId,
            text: `The LLM provided an empty response. This might indicate an issue with the context, model, or request. The LLM should acknowledge this and provide a helpful response.`,
            type: 'error',
            metadata: {
                isError: true,
                errorType: 'empty_response',
                errorSource: 'llm_response'
            }
        });
        
        // Call processEmptyResponse which will prompt the LLM again to handle this specific error
        // Use the postMessage tool to route the response through the LLM instead of hardcoding
        toolCalls = [{
            tool: "postMessage",
            parameters: {
                reasoning: "Handling empty LLM response"
            },
            reasoning: "Empty response handling - letting the LLM decide what to say"
        }];
    }
    
    // Return the formatted response
    return {
        toolCalls,
        message,
        model: response.model,
        usage: response.usage
    };
}

/**
 * Build the prompt for the LLM
 * @param {string} threadId - Thread ID to build the prompt for
 * @returns {Array<Object>} - JSON context array for the LLM
 */
function buildPrompt(threadId) {
    // Get context builder
    const contextBuilder = getContextBuilder();
    
    // Get thread context
    const context = contextBuilder.getMetadata(threadId, 'context') || {};
    
    // Use the new JSON context format builder with skipLogging to avoid duplication
    let jsonContext = contextBuilder.buildFormattedLLMContext(threadId, {
        limit: 25,
        includeBotMessages: true,
        includeToolCalls: true,
        skipLogging: true // Skip logging in context builder since we'll do it here
    });
    
    // Check if we got a valid context with messages
    if (!jsonContext || !Array.isArray(jsonContext) || jsonContext.length === 0) {
        logger.error(`❌ Failed to build normal context for thread ${threadId}, attempting emergency context`);
        
        // Try direct context access - don't rely on context builder's filtering
        try {
            logger.info(`Attempting direct thread message access...`);
            
            // Get raw messages from context builder
            let rawMessages = [];
            if (contextBuilder.threadMessages && contextBuilder.threadMessages.has(threadId)) {
                const messageIds = contextBuilder.threadMessages.get(threadId);
                if (messageIds && Array.isArray(messageIds) && messageIds.length > 0) {
                    logger.info(`Found ${messageIds.length} message IDs directly`);
                    rawMessages = messageIds
                        .map(id => contextBuilder.messages.get(id))
                        .filter(Boolean);
                    logger.info(`Retrieved ${rawMessages.length} raw messages directly`);
                }
            }
            
            // If we have raw messages, create a minimal context manually
            if (rawMessages.length > 0) {
                logger.info(`Creating manual context from ${rawMessages.length} raw messages`);
                jsonContext = rawMessages.map((msg, idx) => {
                    // Determine role based on source
                    const role = msg.source === 'user' ? 'user' : 
                               msg.source === 'system' ? 'system' : 'assistant';
                    
                    // Create content based on role
                    const content = role === 'user' ? 
                        { text: msg.text || '', userid: msg.sourceId || 'unknown' } : 
                        msg.text || '';
                    
                    return {
                        role,
                        content,
                        timestamp: msg.timestamp || new Date().toISOString(),
                        turn: idx + 1
                    };
                });
                
                logger.info(`Manual context created with ${jsonContext.length} items`);
            }
        } catch (directError) {
            logger.error(`Direct thread access failed: ${directError.message}`);
        }
        
        // If direct access didn't work, try emergency context
        if (!jsonContext || jsonContext.length === 0) {
            try {
                jsonContext = contextBuilder.buildEmergencyContext(threadId, context);
                logger.info(`✅ Built emergency context with ${jsonContext.length} items`);
            } catch (emerError) {
                logger.error(`❌ Emergency context also failed: ${emerError.message}`);
                
                // Last resort - hardcoded minimal context
                jsonContext = [
                    {
                        role: 'system',
                        content: 'CRITICAL: Context building completely failed. Please respond to the user with a generic helpful message and call finishRequest.'
                    },
                    {
                        role: 'user',
                        content: {
                            text: context?.text || 'Hello',
                            userid: context?.userId || 'unknown'
                        }
                    }
                ];
                logger.info('Using hardcoded minimal context as last resort');
            }
        }
    }
    
    // Always log a summary of the messages being sent
    logger.info(`Sending ${jsonContext.length} JSON context items to LLM`);
    
    // Final check: strip any dev keys that might have made it through
    jsonContext = jsonContext.map(entry => {
        if (entry.role === 'user' && entry.content && typeof entry.content === 'object' && entry.content.text) {
            // Check if the user message text starts with the dev key
            if (entry.content.text.startsWith('!@#')) {
                const originalText = entry.content.text;
                entry.content.text = entry.content.text.substring(3).trim();
                logger.info(`FINAL CHECK: Stripped dev key (!@#) from user message. Original: "${originalText}", Final: "${entry.content.text}"`);
            }
        }
        
        // Ensure assistant messages always have content
        if (entry.role === 'assistant' && (!entry.content || entry.content === '')) {
            logger.warn(`FINAL CHECK: Found empty content in assistant message, adding placeholder content`);
            entry.content = 'Assistant response';
        }
        
        return entry;
    });
    
    // Return the JSON context
    return jsonContext;
}

/**
 * Format messages from context builder into LLM format
 * @param {Array} messages - Messages from context builder
 * @returns {Array} - Formatted messages for LLM
 */
function formatMessagesForLLM(messages) {
    if (!messages || !Array.isArray(messages)) {
        return [];
    }
    
    return messages.map(msg => {
        if (msg.source === 'user') {
            // User message
            return {
                role: 'user',
                content: msg.text || '',
                name: `user_${Date.now().toString()}`
            };
        } else if (msg.source === 'llm' || msg.source === 'assistant') {
            // Assistant message - include reasoning if available
            let content = msg.text || '';
            if (msg.reasoning) {
                content += `\n\n[Reasoning: ${msg.reasoning}]`;
            }
            return {
                role: 'assistant',
                content: content,
                name: `assistant_${Date.now().toString()}`
            };
        } else if (msg.source === 'system') {
            // System message
            return {
                role: 'system',
                content: msg.text || '',
                name: `system_${Date.now().toString()}`
            };
        } else {
            logger.warn(`Unknown message source: ${msg.source}`);
            return null;
        }
    }).filter(Boolean);
}

/**
 * Format tool response in a clear and consistent way
 * @param {string} toolName - Name of the tool
 * @param {Object} args - Tool arguments
 * @param {Object} response - Tool response
 * @returns {string} - Formatted response
 */
function formatToolResponse(toolName, args, response) {
  try {
    let formattedResponse;
    
    // Add reasoning to all responses if available
    const reasoning = args?.reasoning || "No reasoning provided";
    
    if (toolName === 'postMessage') {
      // For postMessage, show what was sent to the user
      formattedResponse = {
        message_sent: true,
        reasoning: reasoning,
        text: args?.text ? (args.text.length > 100 ? args.text.substring(0, 100) + '...' : args.text) : null
      };
    } else if (toolName === 'getThreadHistory') {
      // For getThreadHistory, show summary of what was retrieved
      if (response?.loopDetected) {
        // Loop detected - make this VERY obvious to the LLM
        formattedResponse = {
          WARNING: "⚠️ LOOP DETECTED in thread history requests!",
          message: response.warning || "You've called getThreadHistory too many times. Use existing history.",
          recommendation: response.recommendation || "Use the thread history you already have. If you need fresh data, use forceRefresh:true",
          thread_history_calls: response.previousCalls || "multiple",
          reasoning: reasoning,
          loopDetected: true
        };
      } else {
        // Normal getThreadHistory response - Make it more helpful for displaying thread history
        formattedResponse = {
          thread_history_retrieved: true,
          reasoning: reasoning,
          messages_count: response?.messagesRetrieved || 0,
          has_parent: response?.threadStats?.parentMessageRetrieved || false,
          // Add the ready-to-use formatted history text at the top level for visibility
          READY_TO_USE_FORMATTED_HISTORY: response?.formattedHistoryText || "",
          INSTRUCTION: "Use the READY_TO_USE_FORMATTED_HISTORY text above for displaying thread history. It already contains all messages properly formatted.",
          message_details: response?.messages || [],
          indexing: response?.indexInfo ? {
            message_range: response.indexInfo.indexRange,
            total_messages: response.indexInfo.messageCount,
            missing_messages: response.indexInfo.missingMessages,
            note: "Each message is prefixed with its [index]. The parent message is always [0]. Use indices to understand which messages you have and which might be missing."
          } : undefined,
          fromCache: response?.fromCache || false,
          cachedAt: response?.cachedAt || null,
          important_note: response?.fromCache 
            ? "⚠️ This data is from cache. The messages are already in your context. Use forceRefresh:true for fresh data." 
            : "✅ This is fresh thread history data. All messages have been added to your context."
        };
      }
    } else if (toolName === 'finishRequest') {
      // For finishRequest, just confirm it was completed
      formattedResponse = {
        request_completed: true,
        reasoning: reasoning,
        summary: args?.summary || "Request completed"
      };
    } else {
      // For other tools, simplify the response
      if (response && typeof response === 'object') {
        if (response.ok !== undefined) {
          // It's likely a Slack API response, simplify it
          formattedResponse = { success: true, reasoning: reasoning };
        } else {
          // Use the response as is, but ensure it's not overly complex
          formattedResponse = { ...response, reasoning: reasoning };
        }
      } else {
        formattedResponse = { success: true, reasoning: reasoning, response: response };
      }
    }
    
    return JSON.stringify(formattedResponse, null, 2);
  } catch (e) {
    // Fallback if there's an error formatting the response
    return JSON.stringify({ 
      success: true, 
      error_formatting: e.message 
    });
  }
}

/**
 * Parses the tool call from the LLM response
 * @param {Object} llmResponse - The response from the LLM
 * @returns {Object} - The parsed tool call
 */
async function parseToolCallFromResponse(llmResponse) {
  try {
    // Log the full LLM response format (first choice only)
    const choice = llmResponse.choices && llmResponse.choices.length > 0 ? llmResponse.choices[0] : null;
    if (!choice) {
      logger.error("❌ No choices found in LLM response");
      throw new Error('No choices in LLM response');
    }
    
    logger.info("🔍 ANALYZING LLM RESPONSE STRUCTURE:");
    logger.info(`Finish reason: ${choice.finish_reason}`);
    
    // Get the assistant's message
    const assistantMessage = choice.message;
    if (!assistantMessage) {
      logger.error("❌ No message found in LLM response choice");
      throw new Error('No message in LLM response');
    }
    
    // Log message components
    logger.info(`Message role: ${assistantMessage.role || 'unknown'}`);
    logger.info(`Has content: ${assistantMessage.content ? 'yes' : 'no'}`);
    logger.info(`Has tool_calls: ${assistantMessage.tool_calls ? 'yes (' + assistantMessage.tool_calls.length + ')' : 'no'}`);
    
    // Check content field more carefully
    if (assistantMessage.content) {
      const contentLength = assistantMessage.content.length;
      logger.info(`Content length: ${contentLength} characters`);
      
      // Examine content for possible JSON pattern
      const content = assistantMessage.content.trim();
      const hasJsonPattern = (content.startsWith('{') && content.endsWith('}')) || 
                            (content.includes('```json') && content.includes('```'));
      
      if (hasJsonPattern) {
        logger.info("⚠️ Content field appears to contain JSON - may be incorrectly formatted tool call");
        
        // Try to extract JSON code block
        if (content.includes('```json')) {
          const matches = content.match(/```json\s*([\s\S]*?)\s*```/);
          if (matches && matches[1]) {
            logger.info("Found code block with JSON - attempting to parse");
            try {
              const parsed = JSON.parse(matches[1].trim());
              logger.info(`Parsed JSON structure: ${JSON.stringify(Object.keys(parsed))}`);
              if (parsed.tool) {
                logger.info(`⚠️ Found embedded tool call: ${parsed.tool}`);
              }
            } catch (e) {
              logger.info(`Failed to parse JSON in code block: ${e.message}`);
            }
          }
        }
      }
    }
    
    // Inspect tool_calls in detail
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      logger.info(`🛠️ TOOL CALLS FOUND: ${assistantMessage.tool_calls.length}`);
      
      // Process all tool calls
      assistantMessage.tool_calls.forEach((toolCall, index) => {
        logger.info(`[${index}] Tool call ID: ${toolCall.id}`);
        logger.info(`[${index}] Type: ${toolCall.type}`);
        
        if (toolCall.function) {
          logger.info(`[${index}] Function name: ${toolCall.function.name}`);
          logger.info(`[${index}] Arguments length: ${toolCall.function.arguments ? toolCall.function.arguments.length : 0} bytes`);
          
          // Try to parse the function arguments
          try {
            if (toolCall.function.arguments) {
              const args = JSON.parse(toolCall.function.arguments);
              logger.info(`[${index}] Arguments parsed successfully: ${JSON.stringify(Object.keys(args))}`);
              
              // Check for nested reasoning or parameters (common mistake)
              if (args.parameters && args.parameters.reasoning) {
                logger.info(`⚠️ ISSUE: Found nested reasoning inside parameters - will be moved to top level`);
              }
              if (args.parameters && args.parameters.parameters) {
                logger.info(`⚠️ ISSUE: Found nested parameters inside parameters - improper nesting detected`);
              }
              
              // Check if top-level reasoning exists
              if (!args.reasoning) {
                logger.info(`⚠️ ISSUE: No top-level reasoning found - may need to generate default`);
              }
            }
          } catch (error) {
            logger.info(`[${index}] Failed to parse arguments: ${error.message}`);
            logger.info(`[${index}] Raw arguments: ${toolCall.function.arguments}`);
          }
        } else {
          logger.info(`[${index}] No function data - malformed tool call`);
        }
      });
    }

    // Standard OpenAI format with tool_calls array
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      logger.info("Tool call format: Using native OpenAI tool_calls format");
      
      // Extract tool calls from the response
      const toolCalls = [];
      
      // Process each tool call in the response
      for (const toolCall of assistantMessage.tool_calls) {
        // Only process function type tool calls (current OpenAI standard)
        if (toolCall.type !== 'function' || !toolCall.function) {
          logger.warn(`Skipping non-function tool call: ${toolCall.type}`);
          continue;
        }
        
        const toolName = toolCall.function.name;
        
        // Parse the function arguments
        let parameters = {};
        try {
          parameters = JSON.parse(toolCall.function.arguments);
          logger.info(`Successfully parsed arguments for tool: ${toolName}`);
        } catch (error) {
          logger.warn(`Failed to parse arguments for tool ${toolName}: ${error.message}`);
          // Even if parsing fails, try to use it anyway
          parameters = { text: toolCall.function.arguments, reasoning: "Argument parsing failed" };
        }
        
        // Add default reasoning if not provided
        if (!parameters.reasoning) {
          logger.info(`No reasoning found for ${toolName}, adding default reasoning`);
          parameters.reasoning = "Auto-generated reasoning for tool call";
        }
        
        toolCalls.push({
          tool: toolName,
          parameters,
          reasoning: parameters.reasoning
        });
      }
      
      logger.info(`Successfully extracted ${toolCalls.length} tool calls from native format`);
      
      // Final standardization: For each tool call, ensure reasoning is at the top level
      for (const toolCall of toolCalls) {
        // If there's no top-level reasoning but there is parameters.reasoning, move it to top level
        if (!toolCall.reasoning && toolCall.parameters?.reasoning) {
          toolCall.reasoning = toolCall.parameters.reasoning;
          delete toolCall.parameters.reasoning;
          logger.info('Moved reasoning from parameters to top level');
        }
        
        // If there's no reasoning at all, add a default
        if (!toolCall.reasoning) {
          toolCall.reasoning = "Auto-generated reasoning for tool call";
          logger.info('Added default reasoning at top level');
        }
      }
      
      return { toolCalls };
    } else {
      // Handle case where tool calls aren't present
      logger.info("⚠️ No tool_calls found in response. Checking for content to use as postMessage");
      
      // Default to a postMessage with the content
      if (assistantMessage.content) {
        // Log the content transformation
        logger.info(`Converting content to postMessage: ${assistantMessage.content.substring(0, 50)}${assistantMessage.content.length > 50 ? '...' : ''}`);
        
        // Try to detect if the content is actually a JSON string representing a tool call
        const content = assistantMessage.content.trim();
        
        // Check if content looks like a JSON object that might be a tool call
        if ((content.startsWith('{') && content.endsWith('}')) || 
            (content.includes('```json') && content.includes('```'))) {
          logger.info("Detected possible JSON tool call in content field");
          
          try {
            // Extract JSON if it's in a code block
            let jsonContent = content;
            if (content.includes('```json')) {
              const matches = content.match(/```json\s*([\s\S]*?)\s*```/);
              if (matches && matches[1]) {
                jsonContent = matches[1].trim();
                logger.info("Extracted JSON from code block");
              }
            }
            
            // Clean up any escaping issues
            jsonContent = preprocessLlmJson(jsonContent);
            
            // Try to parse as JSON
            const parsedContent = JSON.parse(jsonContent);
            logger.info(`Successfully parsed content as JSON: ${JSON.stringify(Object.keys(parsedContent))}`);
            
            // Check if it has a tool field, which indicates it's trying to be a tool call
            if (parsedContent.tool) {
              logger.info(`✅ Detected embedded tool call in content: ${parsedContent.tool}`);
              
              // Format as a proper tool call
              return {
                toolCalls: [{
                  tool: parsedContent.tool,
                  parameters: parsedContent.parameters || {},
                  reasoning: parsedContent.reasoning || "Auto-extracted from message content"
                }]
              };
            } else {
              logger.info("JSON doesn't contain a tool field - treating as regular content");
            }
          } catch (parseError) {
            logger.warn(`Failed to parse content as tool call JSON: ${parseError.message}`);
          }
        }
        
        // If we couldn't parse as a tool call or it wasn't a valid tool call JSON,
        // fall back to treating as regular message content
        logger.info("No tool calls found in content - creating implicit postMessage");
        return {
          toolCalls: [{
            tool: 'postMessage',
            parameters: {
              text: assistantMessage.content,
              reasoning: "Converting regular message to tool call"
            },
            reasoning: "Converting regular message to tool call"
          }]
        };
      } else {
        logger.error("❌ No content or tool calls found in response - cannot create tool call");
        throw new Error('No content or tool calls found in response');
      }
    }
  } catch (error) {
    logger.warn(`Error parsing tool call: ${error.message}`);
    throw error;
  }
}

/**
 * Gets the current date and time in Brazil (Brasília timezone)
 * @returns {string} - Formatted date and time string
 */
function getBrazilDateTime() {
    const now = new Date();
    return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
    }).format(now);
}

/**
 * Processes parameters that may be JSON strings but should be objects/arrays
 * @param {Object} parameters - The parameters object from the LLM
 * @param {string} toolName - The name of the tool being called
 * @returns {Object} - The processed parameters
 */
function processJsonStringParameters(parameters, toolName) {
    if (!parameters) return parameters;
    
    // Clone the parameters to avoid modifying the original
    const processedParams = {...parameters};
    
    // Process each parameter that might be a JSON string but should be an object/array
    Object.keys(processedParams).forEach(paramName => {
        const value = processedParams[paramName];
        
        // Only process string values that look like JSON arrays or objects
        if (typeof value === 'string' && 
            ((value.startsWith('[') && value.endsWith(']')) || 
             (value.startsWith('{') && value.endsWith('}')))
           ) {
            try {
                // Common parameter names that should be arrays or objects
                const arrayParams = ['buttons', 'options', 'fields', 'elements', 'items'];
                const objectParams = ['metadata', 'context', 'config'];
                
                // Check if we should attempt to parse this parameter
                if (arrayParams.includes(paramName) || 
                    objectParams.includes(paramName) ||
                    paramName.endsWith('List') || 
                    paramName.endsWith('Array') ||
                    paramName.endsWith('Object') ||
                    paramName.endsWith('Map')) {
                    
                    console.log(`Attempting to parse parameter "${paramName}" from JSON string to object/array`);
                    processedParams[paramName] = JSON.parse(value);
                    console.log(`Successfully parsed "${paramName}" to ${Array.isArray(processedParams[paramName]) ? 'array' : 'object'}`);
                }
            } catch (error) {
                console.log(`Error parsing parameter "${paramName}": ${error.message}`);
            }
        }
    });
    
    // Tool-specific handling for special cases
    switch (toolName) {
        case 'createButtonMessage':
            if (typeof processedParams.buttons === 'string') {
                try {
                    logger.info('Parsing buttons parameter from JSON string to array');
                    processedParams.buttons = JSON.parse(processedParams.buttons);
                } catch (error) {
                    logger.warn(`Error parsing buttons parameter: ${error.message}`);
                }
            }
            break;
            
        case 'updateMessage':
            // Handle fields parameter for updateMessage
            if (typeof processedParams.fields === 'string') {
                try {
                    logger.info('Parsing fields parameter from JSON string to array');
                    processedParams.fields = JSON.parse(processedParams.fields);
                } catch (error) {
                    logger.warn(`Error parsing fields parameter: ${error.message}`);
                }
            }
            break;
            
        case 'createEmojiVote':
            // Handle options parameter for createEmojiVote
            if (typeof processedParams.options === 'string') {
                try {
                    logger.info('Parsing options parameter from JSON string to array');
                    processedParams.options = JSON.parse(processedParams.options);
                } catch (error) {
                    logger.warn(`Error parsing options parameter: ${error.message}`);
                }
            }
            break;
            
        // Add other tools as needed
    }
    
    return processedParams;
}

/**
 * Extract button information from raw JSON or from block builder syntax
 * @param {string} jsonString - Raw LLM response to extract button info from
 * @returns {Object} - Object containing extracted buttons array
 */
function extractButtonInfo(jsonString) {
  // Default return value
  const result = {
    buttons: []
  };
  
  try {
    logger.debug('🔍 Attempting to extract button information');
    
    // First check for #buttons syntax in block builder format
    const buttonMatch = jsonString.match(/#buttons:\s*\[(.*?)\]/s);
    if (buttonMatch) {
      logger.info("FOUND BUTTON DEFINITION IN TEXT: ", buttonMatch[0]);
      const buttonContent = buttonMatch[1];
      
      // Parse button content into button objects
      try {
        const buttonDefinitions = buttonContent.split(',').map(btn => btn.trim());
        logger.info(`📋 Button definitions found (${buttonDefinitions.length}):`, buttonDefinitions);
        
        result.buttons = buttonDefinitions.map((buttonDef, index) => {
          const parts = buttonDef.split('|').map(part => part.trim());
          logger.info(`🔘 Button ${index + 1} parts:`, parts);
          
          return {
            text: parts[0],
            value: parts[1] || `option${index + 1}`,
            style: parts[2] || undefined
          };
        });
        logger.info(`✅ Parsed ${result.buttons.length} buttons from #buttons syntax`);
        logger.info(`📦 Button objects:`, JSON.stringify(result.buttons, null, 2));
      } catch (btnError) {
        logger.warn(`❌ Error parsing button definitions: ${btnError.message}`);
      }
      
      return result;
    }
    
    // Then check for "actions" array in the raw JSON (Slack legacy format)
    const actionsMatch = jsonString.match(/"actions"\s*:\s*\[([\s\S]*?)\]/);
    if (actionsMatch) {
      logger.info("FOUND ACTIONS ARRAY IN JSON");
      try {
        const actionsText = actionsMatch[1];
        // Parse action objects from the actions array
        const actionObjects = extractObjectsFromJsonArray(actionsText);
        
        logger.info(`Found ${actionObjects.length} action objects`);
        result.buttons = actionObjects.map((objStr, index) => {
          // Extract text and value from action object
          const textMatch = objStr.match(/"text"\s*:\s*"([^"]*)"/);
          const valueMatch = objStr.match(/"value"\s*:\s*"([^"]*)"/);
          
          const text = textMatch ? textMatch[1] : `Option ${index + 1}`;
          console.log(`🔘 Action ${index + 1} text: "${text}"`);
          
          return {
            text: text,
            value: valueMatch ? valueMatch[1] : `option${index + 1}`
          };
        });
        logger.info(`✅ Extracted ${result.buttons.length} buttons from actions array`);
        logger.info(`📦 Button objects:`, JSON.stringify(result.buttons, null, 2));
      } catch (actionsError) {
        logger.warn(`❌ Error parsing actions array: ${actionsError.message}`);
      }
      
      return result;
    }
    
    // Finally check for direct "buttons" array in the JSON
    const buttonsMatch = jsonString.match(/"buttons"\s*:\s*\[([\s\S]*?)\]/);
    if (buttonsMatch) {
      logger.info("FOUND BUTTONS ARRAY IN JSON");
      try {
        const buttonsText = buttonsMatch[1];
        
        // Check if it's a simple string array ["Option 1", "Option 2"]
        const stringMatches = buttonsText.match(/"([^"]*)"/g);
        if (stringMatches) {
          logger.info(`📋 String buttons found (${stringMatches.length}):`, stringMatches);
          
          result.buttons = stringMatches.map((match, index) => {
            const text = match.replace(/"/g, '');
            console.log(`🔘 Button ${index + 1} text: "${text}"`);
            
            // Check if this is pipe-separated format like "Feijoada|feijoada|primary"
            if (text.includes('|')) {
              const parts = text.split('|').map(part => part.trim());
              logger.info(`🔀 Splitting button ${index + 1} by pipes:`, parts);
              
              return {
                text: parts[0],
                value: parts[1] || text.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || `option${index + 1}`,
                style: parts[2] || undefined
              };
            }
            
            return {
              text,
              value: text.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || `option${index + 1}`
            };
          });
          logger.info(`✅ Extracted ${result.buttons.length} buttons from string array`);
          logger.info(`📦 Button objects:`, JSON.stringify(result.buttons, null, 2));
          return result;
        }
        
        // Otherwise try to parse as object array
        const buttonObjects = extractObjectsFromJsonArray(buttonsText);
        logger.info(`📋 Button objects found (${buttonObjects.length})`);
        
        result.buttons = buttonObjects.map((objStr, index) => {
          const textMatch = objStr.match(/"text"\s*:\s*"([^"]*)"/);
          const valueMatch = objStr.match(/"value"\s*:\s*"([^"]*)"/);
          const styleMatch = objStr.match(/"style"\s*:\s*"([^"]*)"/);
          
          let text = textMatch ? textMatch[1] : `Option ${index + 1}`;
          console.log(`🔘 Button ${index + 1} text: "${text}"`);
          
          // Check if text contains pipe-separated format
          if (text.includes('|')) {
            const parts = text.split('|').map(part => part.trim());
            logger.info(`🔀 Splitting button ${index + 1} by pipes:`, parts);
            
            return {
              text: parts[0],
              value: parts[1] || (valueMatch ? valueMatch[1] : `option${index + 1}`),
              style: parts[2] || (styleMatch ? styleMatch[1] : undefined)
            };
          }
          
          return {
            text,
            value: valueMatch ? valueMatch[1] : `option${index + 1}`,
            style: styleMatch ? styleMatch[1] : undefined
          };
        });
        logger.info(`✅ Extracted ${result.buttons.length} buttons from object array`);
        logger.info(`📦 Button objects:`, JSON.stringify(result.buttons, null, 2));
      } catch (buttonsError) {
        logger.warn(`❌ Error parsing buttons array: ${buttonsError.message}`);
      }
    }
  } catch (error) {
    logger.warn(`❌ Error in extractButtonInfo: ${error.message}`);
  }
  
  return result;
}

/**
 * Extract objects from a JSON array string using brace matching
 * @param {string} arrayText - Text content of a JSON array
 * @returns {Array<string>} - Array of object strings
 */
function extractObjectsFromJsonArray(arrayText) {
  const objects = [];
  let braceCount = 0;
  let objectStart = 0;
  
  for (let i = 0; i <= arrayText.length; i++) {
    const char = i < arrayText.length ? arrayText[i] : null;
    if (char === '{') {
      if (braceCount === 0) objectStart = i;
      braceCount++;
    } else if (char === '}') {
      braceCount--;
      if (braceCount === 0) {
        objects.push(arrayText.substring(objectStart, i + 1));
      }
    }
  }
  
  return objects;
}

/**
 * Logs detailed information about the messages context for debugging
 * @param {Object} threadState - Thread state
 * @param {Array} messages - Messages array being sent to the LLM
 */
function logDetailedContext(threadState, messages) {
  logger.detail("\n--- DETAILED CONTEXT LOG ---");
  
  // Log message history
  logger.info("Messages in threadState:", threadState.messages?.length || 0);
  if (threadState.messages && threadState.messages.length > 0) {
    logger.info("Thread message history:");
    threadState.messages.forEach((msg, idx) => {
      const userType = msg.isUser ? 'USER' : 'BOT';
      const noteType = msg.isSystemNote ? 'SYSTEM NOTE' : '';
      const buttonType = msg.isButtonClick ? 'BUTTON CLICK' : '';
      const textPreview = msg.text?.substring(0, 50) + (msg.text?.length > 50 ? '...' : '');
      logger.info(`[${idx + 1}] ${userType}: ${noteType} ${buttonType} ${textPreview}`);
    });
  }
  
  // Log tool execution history
  if (typeof threadState.getToolExecutionHistory === 'function') {
    const toolHistory = threadState.getToolExecutionHistory(5);
    if (toolHistory.length > 0) {
      logger.info("\nRecent tool executions:");
      toolHistory.forEach((exec, idx) => {
        // Fix for undefined tool names
        const toolName = exec.toolName || 'unknown_tool';
        console.log(`[${idx + 1}] ${toolName} - ${exec.error ? 'ERROR' : 'SUCCESS'}`);
      });
    }
  }
  
  // Log messages being sent to LLM
  logger.info("\nMessages to LLM:");
  messages.forEach((msg, idx) => {
    const content = typeof msg.content === 'string' ? 
      `${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}` : 
      'Complex content';
    logger.info(`[${idx + 1}] ${msg.role.toUpperCase()}: ${content}`);
  });
  
  // Log button selection info if available
  if (threadState.lastButtonSelection) {
    logger.info("\nButton selection:");
    logger.info(`Value: ${threadState.lastButtonSelection.value}`);
    logger.info(`Text: ${threadState.lastButtonSelection.text}`);
    logger.info(`Time: ${threadState.lastButtonSelection.timestamp}`);
  }
  
  logger.info("-------------------------");
}

/**
 * Preprocesses JSON from the LLM to handle common issues
 * @param {Object} json - The JSON object to preprocess
 * @returns {Object} - The preprocessed JSON object
 */
function preprocessLlmJson(json) {
    if (!json || typeof json !== 'object') {
        return json;
    }
    
    // Handle case where tool is nested inside parameters
    if (json.parameters && json.parameters.tool) {
        json.tool = json.parameters.tool;
        delete json.parameters.tool;
    }
    
    // Handle case where reasoning is inside parameters
    if (json.parameters && json.parameters.reasoning) {
        json.reasoning = json.parameters.reasoning;
        delete json.parameters.reasoning;
    }
    
    return json;
}

/**
 * Format thread history result in a more readable way
 * @param {Object} result - Thread history result
 * @returns {string} - Formatted result
 */
function formatThreadHistoryResult(result) {
    if (!result) return "No result";
    
    // Special handling for loop detection
    if (result.loopDetected) {
        return `{
  "WARNING": "${result.warning || 'Loop detected in getThreadHistory calls'}",
  "previousCalls": ${result.previousCalls || 'multiple'},
  "recommendation": "${result.recommendation || 'Use existing thread history or forceRefresh'}",
  "loopDetected": true
}`;
    }
    
    return `{
  "messagesRetrieved": ${result.messagesRetrieved || 0},
  "threadStats": {
    "totalMessages": ${result.threadStats?.totalMessagesInThread || 0},
    "remainingMessages": ${result.threadStats?.remainingMessages || 0}
  },
  "indexInfo": {
    "range": "${result.indexInfo?.indexRange || 'none'}",
    "totalCount": ${result.indexInfo?.messageCount || 0},
    "missing": ${result.indexInfo?.missingMessages || 0}
  },
  "fromCache": ${result.fromCache ? 'true' : 'false'}${result.cachedAt ? `,\n  "cachedAt": "${result.cachedAt}"` : ''}
}`;
}

module.exports = {
    getNextAction,
    buildPrompt,
    preprocessLlmJson
};
