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


// Shared constants for message formatting to avoid duplication
const COMMUNICATION_STYLE = `- Be enthusiastic, cheerful, and energetic in your responses! 🎉
- Use emojis liberally throughout your messages for personality and fun 😊 💯 ✨
- Use the addReaction tool to react with appropriate emojis to user messages
- Freely use multiple emoji reactions when it feels right - don't limit yourself!
- Include custom workspace emojis like kek-doge, pepebigbrain, or this-is-fine-fire in your responses
- Mix standard emojis with custom ones for better expression
- Be conversational and friendly, showing excitement when helping users
- Use exclamation points to convey enthusiasm where appropriate!
- Express positivity with phrases like "Great question!" or "I'd love to help with that!"
- Use markdown formatting for readability and to make messages visually appealing
- Format code with \`\`\`language\\n code \`\`\` blocks
- Keep your enthusiasm balanced - be excited but still professional
- Use markdown (*bold*, _italic_) for basic formatting and specialized tags ([header]...[!header]) for complex elements
- Sound genuinely happy to be helping the user with their questions`;

const CRITICAL_BEHAVIOR = `1. YOU MUST ALWAYS USE TOOL CALLS - NEVER RESPOND WITH PLAINTEXT
2. NEVER send more than one message per user request unless explicitly needed
3. ALWAYS call finishRequest after sending your response
4. NEVER repeat a postMessage with the same content
5. ALWAYS check if you've already responded before sending a new message
6. Each user message should get exactly ONE response from you
7. NEVER include raw code or function calls in your message content
8. ALWAYS use the standardized JSON format for tool calls as shown below
9. IMPORTANT: Text written outside of tool calls will NOT be shown to the user
10. ALL your responses to users MUST go through the postMessage tool
11. SEND ONLY ONE TOOL CALL AT A TIME - Do not include multiple tool calls in one response
12. WHEN HANDLING ERRORS: Never use hardcoded responses. Always decide what to tell the user based on the error context.
13. USE EMOJIS FREQUENTLY - Both in text responses and as emoji reactions using addReaction
14. ⚠️⚠️⚠️ BUTTON CREATION (CRITICAL): You MUST use the tool 'postMessage' with #buttons:[Label|value|style, ...] syntax INSIDE the text parameter. Example: "#header: Title\\n\\n#section: Text\\n\\n#buttons:[Option 1|value1, Option 2|value2]" ⚠️⚠️⚠️
15. BUTTON SELECTIONS: When a user clicks a button, the message is automatically updated to show their selection. Send a new message acknowledging their choice and providing next steps.`;

const BBCODE_FORMATTING = `### Markdown (for basic formatting):
- *bold* for bold text
- _italic_ for italic text
- \`code\` for inline code
- \`\`\`language
  code block
  \`\`\` for code blocks
- > text for blockquotes
- * or - for bullet lists
- 1. 2. 3. for numbered lists

### Special Formatting Tags (with parentheses):
- (header)Title(!header) for section headers
- (context)Small helper text(!context) for smaller helper text
- (divider) for horizontal dividers
- #userContext: <@USER1> <@USER2> <@USER3> | optional description text
  * Create user profile mentions in a special context block
  * Always format user IDs with <@USER_ID> syntax
  * Example: #userContext: <@U123456> | is helping with this task
- (section:image_url:alt_text)Content with an image accessory(!section) for sections with images

### Hyperlinks and URLs:
- For hyperlinks, use Slack's format: <URL|text label> 
  * Example: <https://slack.com|Visit Slack>
  * IMPORTANT: Do NOT use Markdown format [text](URL) for links or images

### Image Display Options (THREE METHODS):
1. **Standalone Image Block** - Use either:
   * Markdown image syntax: ![Alt text](https://example.com/image.jpg)
   * BBCode format: (image:https://example.com/image.jpg:Alt text)
   This displays a full-width image in Slack.

2. **Section with Image** - Use:
   * (section:https://example.com/image.jpg:Alt text)Content with image accessory(!section)
   This shows text content with a small image thumbnail on the right.

3. **Image Hyperlink** - Use:
   * <https://example.com/image.jpg|View image>
   This shows a clickable link but doesn't embed the image.`;

const BLOCK_BUILDER_GUIDE = `### Markdown (for basic formatting):
- *bold* for bold text
- _italic_ for italic text
- \`code\` for inline code
- \`\`\`language
  code block
  \`\`\` for code blocks
- > text for blockquotes
- * or - for bullet lists
- 1. 2. 3. for numbered lists

### Block Builder Syntax (Modern Method):
Use the block builder syntax for all formatting:
#header: Title text
#section: Standard content
#context: Helper text
#divider:
#userContext: <@USER1> <@USER2> | description text
#image: https://example.com/image.jpg | altText:Image description
#contextWithImages: Text | images:[https://example.com/image1.jpg|Alt text 1, https://example.com/image2.jpg|Alt text 2]
#buttons: [Button 1|value1|primary, Button 2|value2|danger, Button 3|value3]
#fields: [*Title*|Value]

### Button Creation (IMPORTANT):
When creating interactive buttons, ALWAYS use the block builder format with postMessage:

\`\`\`
#header: Choose an Option
#section: Select the option you prefer
#buttons: [First Option|option1|primary, Second Option|option2, Third Option|option3]
\`\`\`

### Hyperlinks:
- For hyperlinks, use Slack's format: <URL|text label> 
  * Example: <https://slack.com|Visit Slack>
  * IMPORTANT: Do NOT use Markdown format [text](URL) for links`;

const TOOL_CALL_FORMAT = `\`\`\`json
{
  "tool": "toolName",
  "reasoning": "Brief explanation of why you're using this tool",
  "parameters": {
    "param1": "value1",
    "param2": "value2"
  }
}
\`\`\``;

// Adding a new constant with explicit examples of correct and incorrect formats
const PARAMETER_STRUCTURE_EXAMPLES = `CORRECT ✅ (reasoning at top level, parameters separate):
\`\`\`json
{
  "tool": "postMessage",
  "reasoning": "Responding to user's question",
  "parameters": {
    "text": "Your message here",
    "color": "blue"
  }
}
\`\`\`

INCORRECT ❌ (duplicated reasoning or nested parameters):
\`\`\`json
{
  "tool": "postMessage",
  "reasoning": "Responding to user's question",
  "parameters": {
    "reasoning": "DUPLICATE - NEVER PUT REASONING HERE",
    "parameters": {
      "text": "NEVER NEST PARAMETERS LIKE THIS"
    },
    "text": "Your message here"
  }
}
\`\`\``;

const COMPANY_INFO = `- You work at CloudWalk, a fintech company specializing in payment solutions
- CloudWalk's main products include "JIM" and "InfinitePay"
- Most employees are Brazilian and based in Brazil, though some work remotely from other countries
- The company focuses on payment processing, financial technology, and related services`;

const FORMAT_REQUIREMENTS = `1. ALL tool calls must be in \`\`\`json code blocks
2. ALWAYS wrap tool calls in \`\`\`json code blocks
3. NEVER mix formats - use ONLY this format for ALL tool calls
4. NEVER prefix tool names with "functions." or any other namespace
5. EVERY tool call MUST include a reasoning parameter AT THE TOP LEVEL ONLY
6. NEVER duplicate the reasoning field inside parameters
7. NEVER nest a parameters object inside parameters - avoid duplicate keys
8. Text outside tool calls is NOT sent to users
9. Send only ONE tool call per response - DO NOT include multiple tool calls
10. For a normal user interaction: first send postMessage, then after receiving a response, send finishRequest`;

const REMEMBER_CRITICAL = `- YOU MUST ALWAYS USE TOOL CALLS - NEVER RESPOND WITH PLAINTEXT
- The reasoning field MUST ALWAYS be at the top level, NEVER inside parameters
- NEVER duplicate fields like reasoning or parameters in nested objects
- All your responses to users MUST go through the postMessage tool 
- Send only ONE tool call at a time - DO NOT send multiple tool calls in the same response
- Wait for each tool call to complete before sending another one
- After sending a postMessage, always send a finishRequest to complete the interaction`;

// Load the system prompt
const systemPromptPath = path.join(__dirname, 'prompts', 'system_prompt.md');
const systemPrompt = readFileSync(systemPromptPath, 'utf8');

/**
 * Get the system message for the LLM
 * @param {Object} context - Context for the conversation
 * @returns {string} - System message
 */
function getSystemMessage(context) {
  // Add context-specific information if available
  const contextInfo = context ? 
    `You are currently in a conversation with a user in a Slack channel (${context.channelId}).` : 
    `You are chatting with a user in Slack.`;
  
  return `You are a helpful AI assistant integrated with Slack. ${contextInfo}
You have various tools you can use to help users.

When retrieving thread history:
1. You can use the getThreadHistory tool whenever you need context
2. Thread history contains messages with position indices like [0], [1], [2]
3. Message [0] is ALWAYS the first/parent message in the thread
4. Once you have thread history, you don't need to request it again
5. Use forceRefresh:true if you need absolutely fresh data
6. Thread history is cached for 30 seconds to avoid redundant API calls

For users asking to see thread history:
- Call getThreadHistory with forceRefresh:true to get the latest messages
- Use the provided formattedHistoryText field from the response when displaying history
- If a user asks multiple times, always get fresh history with forceRefresh:true
- Display ALL messages, not just the first one or parent message
- Thread history display should follow this format:
  #header: Aqui está o histórico da nossa conversa:
  [Content from formattedHistoryText]
  #divider:

Important guidelines:
- Be concise, helpful, and friendly in your responses
- Use thread history indices to understand conversation flow
- When someone asks a follow-up question, refer to thread history before asking for details they may have already provided
- YOU decide when to retrieve thread history - no external code will force you to do so`;
}

/**
 * Get the next action from the LLM
 * @param {string} threadId The thread ID to get the next action for
 * @returns {Promise<{toolCalls: Array<{tool: string, parameters: Object}>}>}
 */
async function getNextAction(threadId) {
    logger.info(`🧠 Getting next action from LLM for thread: ${threadId}`);
    
    // Get context builder
    const contextBuilder = getContextBuilder();
    
    // Build the prompt with thread-specific information
    const messages = buildPrompt(threadId);
    
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
 * Builds the prompt for the LLM
 * @param {string} threadId - Thread ID
 * @returns {Array} - Messages array for the LLM
 */
function buildPrompt(threadId) {
    // Get context builder
    const contextBuilder = getContextBuilder();
    
    // Get the context information for this thread
    const context = contextBuilder.getMetadata(threadId, 'context');
    
    // Start with the system prompt
    const messages = [{
        role: "system",
        content: getSystemMessage(context)
    }];
    
    // Get thread state representation for the LLM
    const contextMessages = contextBuilder.getThreadMessages(threadId);
    
    // Add messages to prompt
    if (contextMessages && contextMessages.length > 0) {
        logger.info(`Adding ${contextMessages.length} messages to the prompt`);
        
        // Map internal message format to LLM message format
        const mappedMessages = contextMessages.map(msg => {
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
        
        messages.push(...mappedMessages);
    }
    
    // Get the latest user message for thread history detection
    let latestUserMessage = '';
    // Look through contextMessages in reverse to find the most recent user message
    for (let i = contextMessages.length - 1; i >= 0; i--) {
        const msg = contextMessages[i];
        if (msg.source === 'user') {
            latestUserMessage = msg.text || '';
            break;
        }
    }
    
    // Get tool execution history
    const toolExecutions = contextBuilder.getToolExecutionHistory(threadId);
    
    // Add tool executions to the prompt
    if (toolExecutions && toolExecutions.length > 0) {
        logger.info(`Adding ${toolExecutions.length} tool executions to the prompt`);
        
        // Process tool executions to be added to the prompt
        const toolMessages = [];
        
        // Find all getThreadHistory calls
        const threadHistoryTools = toolExecutions.filter(exec => exec.toolName === 'getThreadHistory');
        
        // Check for loop detection in any of the thread history calls
        const loopDetected = threadHistoryTools.some(exec => 
            exec.result && exec.result.loopDetected === true);
            
        // If loop detection was triggered, add a very clear warning
        if (loopDetected) {
            messages.push({
                role: "system",
                content: `⚠️ CRITICAL WARNING: THREAD HISTORY LOOP DETECTED ⚠️

You have called getThreadHistory multiple times in succession, which has triggered loop detection.
This is usually caused by:
1. Repeatedly calling getThreadHistory when you already have the thread history
2. Not using the thread history information you already have
3. Trying to get thread history again without using forceRefresh:true

WHAT TO DO NOW:
- Work with the thread history you already have in your context
- The messages are already prefixed with indices like [0], [1], etc.
- If you absolutely need fresh data, use { forceRefresh: true } when calling getThreadHistory
- AVOID calling getThreadHistory again unless absolutely necessary

This warning is triggered to prevent infinite loops.`,
                name: "loop_detection_warning"
            });
        }
        
        // Add a special message when thread history has been requested multiple times
        if (threadHistoryTools.length > 1) {
            messages.push({
                role: "system",
                content: `IMPORTANT: You have already called getThreadHistory ${threadHistoryTools.length} times. 
You already have the thread history. Do not request it again unless you need different parameters.
The most recent thread history call ${threadHistoryTools[0].error ? 'failed' : 'succeeded'} and ${threadHistoryTools[0].result?.fromCache ? 'returned cached data' : 'retrieved fresh data'}.`
            });
        }
    }
    
    // Build the full set of messages for the LLM
    return messages;
}

/**
 * Format messages for the LLM in a standardized way - using ONLY the contextBuilder
 * @param {Object} threadState - Thread state with context
 * @returns {Array} - Messages array for LLM
 */
function formatMessagesForLLM(threadState) {
  try {
    // Start with empty messages array
    let messages = [];
    
    // Get the thread timestamp
    const threadTs = threadState.getThreadTs ? threadState.getThreadTs() : 
                   threadState.getMetadata ? threadState.getMetadata('context')?.threadTs : 
                   null;
    
    if (!threadTs) {
      logger.warn("No thread timestamp found for context building");
      
      // Add at least the system message
      const context = threadState.getMetadata ? threadState.getMetadata('context') : null;
      messages.push({
        role: 'system',
        content: getSystemMessage(context)
      });
      
      return messages;
    }
    
    // Get context builder
    const contextBuilder = getContextBuilder();
    if (!contextBuilder) {
      logger.error("No context builder available - cannot build context");
      
      // Add at least the system message
      const context = threadState.getMetadata ? threadState.getMetadata('context') : null;
      messages.push({
        role: 'system',
        content: getSystemMessage(context)
      });
      
      return messages;
    }
    
    logger.info(`Building context for thread ${threadTs} using ContextBuilder...`);
    
    // Add system message first
    const context = threadState.getMetadata ? threadState.getMetadata('context') : null;
    messages.push({
      role: 'system',
      content: getSystemMessage(context)
    });
    
    // Use the contextBuilder to get thread messages
    const contextMessages = contextBuilder.buildLLMContext(threadTs, {
      limit: 25, // Reasonable context limit
      includeBotMessages: true
    });
    
    if (!contextMessages || contextMessages.length === 0) {
      logger.warn(`No messages found for thread ${threadTs} in contextBuilder`);
      return messages;
    }
    
    // Check for assistant messages to detect potential duplication
    const assistantMessages = contextMessages.filter(msg => msg.role === 'assistant');
    if (assistantMessages.length > 0) {
      // Add a critical reminder to prevent duplication
      messages.push({
        role: 'system',
        content: `IMPORTANT: You have already sent ${assistantMessages.length} message(s) in this conversation. DO NOT repeat similar information. If you've already answered this query or sent buttons, call finishRequest immediately. ONE response per user message is the rule - never send multiple similar responses.`,
        name: 'duplication_prevention'
      });
    }
    
    // Check if this is a button click context
    const isButtonClick = context && context.isButtonClick === true;
    if (isButtonClick) {
      const buttonInfo = {
        text: context.buttonText || 'unknown button',
        value: context.actionValue || 'unknown value'
      };
      
      // Add a clear system message about the button click
      messages.push({
        role: 'system',
        content: `The user clicked the "${buttonInfo.text}" button with value "${buttonInfo.value}". The interface has ALREADY been updated to show this selection. DO NOT try to update it again or acknowledge the click more than once. Respond with the next appropriate step based on this selection.`,
        name: 'button_click_info'
      });
    }
    
    // Debug: Log the context being sent to the LLM
    logger.info(`Generated ${contextMessages.length} context messages for LLM using ContextBuilder`);
    contextMessages.forEach((msg, i) => {
      const preview = msg.content.length > 50 ? msg.content.substring(0, 50) + '...' : msg.content;
      logger.info(`[${i+1}] ${msg.role.toUpperCase()}: ${preview}`);
    });
    
    // Combine with system message
    return [...messages, ...contextMessages];
  } catch (error) {
    logger.error(`Error formatting messages for LLM: ${error.message}`);
    
    // Add at least the system message
    const context = threadState.getMetadata ? threadState.getMetadata('context') : null;
    return [{
      role: 'system',
      content: getSystemMessage(context)
    }];
  }
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
