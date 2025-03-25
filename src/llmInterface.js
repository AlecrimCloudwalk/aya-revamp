// Interface for communicating with the LLM
const { LLM_API_KEY, LLM_API_URL, LLM_MODEL } = require('./config.js');
const { logError, formatErrorForLLM } = require('./errors.js');
const fetch = require('node-fetch');
const { getToolsForLLM } = require('./tools');

/**
 * Sends the thread state to the LLM and gets the next action to take
 * @param {Object} threadState - The current thread state
 * @param {Array} threadState.messages - Array of user and assistant messages
 * @param {Object} threadState.context - Additional context for the LLM
 * @param {Array} threadState.toolResults - Results from previous tool calls
 * @returns {Promise<{toolName: string, toolArgs: Object}>} - The tool to call next and its arguments
 */
async function getNextAction(threadState) {
  try {
    if (!LLM_API_KEY) {
      throw new Error('LLM_API_KEY is not configured');
    }

    console.log("\n🧠 SENDING REQUEST TO LLM");
    console.log(`Model: ${LLM_MODEL}`);

    // Determine if we have a ThreadState instance or just the state object
    const isThreadStateInstance = typeof threadState.getMetadata === 'function';
    
    // Get context from metadata
    let context = isThreadStateInstance ? threadState.getMetadata('context') : null;
    
    if (!context && isThreadStateInstance) {
      console.log("⚠️ WARNING: No context found in thread state metadata");
    }
    
    // Format messages based on thread state
    const messages = formatMessagesForLLM(threadState);
    
    // Log the actual content we're sending to the LLM for debugging
    console.log("\n--- Content being sent to LLM ---");
    if (context && context.text) {
      console.log(`User's query: "${context.text}"`);
    } else {
      console.log("No user query found in context!");
    }
    console.log(`Sending ${messages.length} messages to LLM`);
    
    // Add detailed context logging
    console.log("\n--- DETAILED CONTEXT LOG ---");
    console.log("Messages in threadState:", threadState.messages?.length || 0);
    if (threadState.messages && threadState.messages.length > 0) {
      console.log("Thread message history:");
      threadState.messages.forEach((msg, idx) => {
        console.log(`[${idx + 1}] ${msg.isUser ? 'USER' : 'BOT'}: ${msg.isSystemNote ? 'SYSTEM NOTE' : ''} ${msg.text?.substring(0, 50)}${msg.text?.length > 50 ? '...' : ''}`);
      });
    }
    
    // Log tool execution history
    if (typeof threadState.getToolExecutionHistory === 'function') {
      const toolHistory = threadState.getToolExecutionHistory(5);
      if (toolHistory.length > 0) {
        console.log("\nRecent tool executions:");
        toolHistory.forEach((exec, idx) => {
          console.log(`[${idx + 1}] ${exec.toolName} - ${exec.error ? 'ERROR' : 'SUCCESS'}`);
        });
      }
    }
    
    // Log messages being sent to LLM
    console.log("\nMessages to LLM:");
    messages.forEach((msg, idx) => {
      const content = typeof msg.content === 'string' ? 
        `${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}` : 
        'Complex content';
      console.log(`[${idx + 1}] ${msg.role.toUpperCase()}: ${content}`);
    });
    console.log("-------------------------");

    // Build the complete LLM request
    const requestBody = {
      model: LLM_MODEL,
      messages,
      temperature: 0.2,
      top_p: 0.95,
      frequency_penalty: 0,
      presence_penalty: 0,
      tools: getAvailableTools(),
      tool_choice: "required"  // Changed from "auto" to "required" to force the model to always use a tool
    };

    // Make the API request to the LLM
    return await sendRequestToLLM(requestBody);
  } catch (error) {
    console.log(`\n❌ LLM ERROR ❌`);
    console.log(`Message: ${error.message}`);
    console.log("--------------------------------");
    
    // Handle and log any errors
    logError('Error getting next action from LLM', error, { threadState });
    
    // Rethrow the error for the orchestrator to handle
    throw error;
  }
}

/**
 * Sends the request to the LLM API with fallback options for error cases
 * @param {Object} requestBody - The full request to send to the LLM
 * @param {Object} threadState - Original thread state
 * @returns {Promise<Object>} - The extracted tool call
 */
async function sendRequestToLLM(requestBody, threadState, isRetry = false) {
  try {
    // Make the API request to the LLM
    const startTime = Date.now();
    const response = await fetch(LLM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM_API_KEY}`
      },
      body: JSON.stringify(requestBody)
    });
    const duration = Date.now() - startTime;
    console.log(`Response received in ${duration}ms`);

    // Check if the request was successful
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`LLM API error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    // Parse the LLM response
    const data = await response.json();
    
    // Extract the tool call from the response
    return await parseToolCallFromResponse(data);
  } catch (error) {
    // If this is a 500 error from the LLM API and not already a retry, 
    // try again with a simplified context
    if (!isRetry && error.message.includes('LLM API error: 500')) {
      console.log("\n⚠️ LLM API 500 ERROR - TRYING SIMPLIFIED REQUEST ⚠️");
      
      // Create a simplified version of the thread state
      // Keep only the system message and the most recent user message
      const simplifiedMessages = requestBody.messages.filter(msg => {
        // Keep the system message
        if (msg.role === 'system') return true;
        
        // Keep only the most recent user message
        if (msg.role === 'user') {
          const userMessages = requestBody.messages.filter(m => m.role === 'user');
          return msg === userMessages[userMessages.length - 1];
        }
        
        return false;
      });
      
      console.log(`Simplified to ${simplifiedMessages.length} messages`);
      
      // Create a new request with simplified context
      const simplifiedRequest = {
        ...requestBody,
        messages: simplifiedMessages
      };
      
      // Try again with the simplified request
      return await sendRequestToLLM(simplifiedRequest, threadState, true);
    }
    
    // If it's already a retry or another kind of error, re-throw
    throw error;
  }
}

/**
 * Filter out development prefixes from user messages
 * @param {string} message - The user's message
 * @returns {string} - Cleaned message
 */
function filterDevPrefix(message) {
  if (!message) return message;
  // Remove the !@# development prefix if present
  if (message.startsWith('!@#')) {
    return message.substring(3).trim();
  }
  return message;
}

/**
 * Gets a system message with instructions and context
 */
function getSystemMessage(context = {}) {
    // Make sure context exists and has expected properties
    const ctx = context || {};
    
    // Get registered tools for dynamically generating the tool list
    let toolsList = '';
    try {
        const registeredTools = getToolsForLLM();
        
        // Create a numbered list of tools
        if (registeredTools && registeredTools.length > 0) {
            toolsList = registeredTools
                .map((tool, index) => `${index + 1}. ${tool.name} - ${tool.description}`)
                .join('\n');
        } else {
            // Fallback if tools aren't available
            toolsList = '1. postMessage - Send a message to the user\n2. finishRequest - End your turn in the conversation';
        }
    } catch (error) {
        console.log('Error getting tools for system message:', error.message);
        // Fallback if there's an error
        toolsList = '1. postMessage - Send a message to the user\n2. finishRequest - End your turn in the conversation';
    }
    
    return `Hi there! You're Aya, a helpful AI assistant in Slack. This is a conversation between you and users.

IMPORTANT CONTEXT:
You're in a ${ctx.isDirectMessage ? 'direct message' : 'thread'} in Slack.
User ID: ${ctx.userId || 'unknown'}
Channel: ${ctx.channelId || 'unknown'}
${ctx.threadTs ? `Thread: ${ctx.threadTs}` : ''}

CRITICAL INSTRUCTIONS:
1. DO NOT send multiple similar messages - ONE response per user query
2. ALWAYS communicate with users by calling tools
3. NEVER output direct content or messages
4. ALWAYS check the conversation history to avoid duplicating messages
5. AFTER creating a button message, DO NOT create another one with the same options
6. After sending a message, call finishRequest to end your turn

YOUR TOOLS:
${toolsList}

TOOL CALL FORMAT:
// DO NOT USE CODE BLOCKS. Return a JSON object directly like this:
{
  "tool": "toolName",
  "parameters": {
    "param1": "value1",
    "reasoning": "Brief explanation of why you're using this tool"
  }
}

⚠️ CRITICAL: DO NOT WRAP YOUR RESPONSE IN CODE BLOCKS OR MARKDOWN. Just return the JSON object directly. ⚠️

IMPORTANT PARAMETERS NOTES:
- For parameters that require arrays or objects, provide them as proper JSON arrays/objects, NOT as string representations.
- CORRECT: "buttons": [{"text": "Option 1", "value": "opt1"}, {"text": "Option 2", "value": "opt2"}]
- INCORRECT: "buttons": "[{\\"text\\": \\"Option 1\\", \\"value\\": \\"opt1\\"}, {\\"text\\": \\"Option 2\\", \\"value\\": \\"opt2\\"}]"
- Always include a "reasoning" parameter in all tool calls to explain your decision.

BUTTON CREATION GUIDELINES:
1. When asked to provide options, create ONLY ONE button message
2. DO NOT create multiple button messages with similar options
3. After creating buttons, call finishRequest - don't create more messages
4. When a user clicks a button, acknowledge their choice with a postMessage

CONVERSATION FLOW:
- User makes a request -> You call postMessage or createButtonMessage -> You call finishRequest
- User clicks a button -> You acknowledge their choice with postMessage -> You call finishRequest
- ONE response cycle per user action

EXAMPLES OF CORRECT FORMAT:

EXAMPLE 1 - Posting a message:
{
  "tool": "postMessage",
  "parameters": {
    "title": "Here's the information you requested",
    "text": "I found the answer to your question...",
    "color": "blue",
    "reasoning": "Responding with requested information"
  }
}

EXAMPLE 2 - Creating a button message:
{
  "tool": "createButtonMessage",
  "parameters": {
    "title": "Choose an option",
    "text": "Please select one of the following options:",
    "buttons": [
      {"text": "Yes", "value": "yes"},
      {"text": "No", "value": "no"},
      {"text": "Maybe", "value": "maybe"}
    ],
    "actionPrefix": "choice",
    "reasoning": "Presenting the user with options to choose from"
  }
}

EXAMPLE 3 - Creating an emoji vote:
{
  "tool": "createEmojiVote",
  "parameters": {
    "title": "Vote on your favorite",
    "text": "React with an emoji to vote:",
    "options": [
      {"emoji": "coffee", "text": "Coffee"},
      {"emoji": "tea", "text": "Tea"}
    ],
    "reasoning": "Creating a poll for user preferences"
  }
}

EXAMPLE 4 - Finishing request (REQUIRED after posting a message):
{
  "tool": "finishRequest",
  "parameters": {
    "summary": "Responded to user request for dinner options",
    "reasoning": "Task has been completed, ending the conversation turn"
  }
}

IMPORTANT REMINDERS:
1. DO NOT wrap your tool call in markdown code blocks
2. Return ONLY the bare JSON object
3. Do not include \`\`\`json or \`\`\` markers
4. Always check the thread history to avoid duplicating messages
5. If you've already responded to the user, don't send a similar message again
6. After creating a button message, call finishRequest - don't create more buttons`;
}

/**
 * Formats the messages for the LLM API based on thread state
 * @param {Object} threadState - Current thread state
 * @returns {Array} - Formatted messages for the LLM
 */
function formatMessagesForLLM(threadState) {
  const messages = [];
  
  // Get context from metadata
  const context = threadState.getMetadata ? threadState.getMetadata('context') : null;
  
  // Add system message
  const systemMessage = getSystemInstructions(context || {});
  messages.push({
    role: 'system',
    content: systemMessage,
  });

  // Debug logging of context
  console.log(`\n---- Building Context for LLM ----`);
  if (context) {
    console.log(`Context details: User:${context.userId}, Channel:${context.channelId}, Thread:${context.threadTs || 'N/A'}`);
    console.log(`Thread Stats: ${context.threadStats ? 
      `${context.threadStats.totalMessagesInThread} total messages` : 
      'Not available'}`);
    console.log(`Messages in context: ${threadState.messages?.length || 0} messages`);
    console.log(`User Message: "${context.text || 'No text'}" (${context.messageType || 'unknown type'})`);
  } else {
    console.log("No context found in thread state!");
  }
  
  // Add important system note about conversation state
  if (threadState.messages && threadState.messages.length > 0) {
    // Check if any messages are from the bot
    const botMessages = threadState.messages.filter(msg => !msg.isUser);
    if (botMessages.length > 0) {
      messages.push({
        role: 'system',
        content: `⚠️ CRITICAL: You have already sent ${botMessages.length} message(s) in this conversation. DO NOT send another message with the same content or options. The user is waiting for your existing message to be processed.`
      });
    }
  }
  
  // Format thread messages if present
  let currentMessageFound = false;
  let prevBotMessageCount = 0;
  
  if (threadState.messages && threadState.messages.length > 0) {
    console.log(`Thread history: ${threadState.messages.length} messages being imported`);
    
    for (const message of threadState.messages) {
      // Check if this is the current user's message (matches the context)
      if (context && message.isUser && message.text === context.text) {
        currentMessageFound = true;
      }
      
      let prefix = '';
      let positionDisplay = '';
      
      // Include chronological position if available
      if (message.threadPosition) {
        positionDisplay = ` [MESSAGE #${message.threadPosition}]`;
      }

      // Only add prefixes for non-system messages
      if (!message.isSystemNote) {
        if (message.isParentMessage) {
          prefix = `THREAD PARENT MESSAGE${positionDisplay}:\n`;
        } else if (message.isButtonClick) {
          // Special formatting for button clicks
          prefix = `BUTTON INTERACTION${positionDisplay}:\n`;
        } else {
          prefix = `THREAD MESSAGE${positionDisplay}:\n`;
        }
      }

      // Determine if message is from the bot or a user
      if (message.isUser) {
        if (message.isButtonClick) {
          // Format button clicks distinctively
          messages.push({
            role: 'user',
            content: `${prefix}USER BUTTON CLICK: ${message.text}`
          });
        } else {
          messages.push({
            role: 'user',
            content: `${prefix}USER MESSAGE: ${message.text || 'No text content'}`
          });
        }
      } else if (message.isSystemNote) {
        // Only include important system notes to reduce noise
        if (message.text.includes("Created interactive buttons") || 
            message.text.includes("auto-completed") ||
            message.text.includes("error")) {
          messages.push({
            role: 'system',
            content: message.text
          });
        }
      } else {
        // For bot messages, format with very clear indication this was already sent
        prevBotMessageCount++;
        
        let sentMessage = '';
        if (message.title) {
          sentMessage += `Title: "${message.title}"\n`;
        }
        sentMessage += `Content: "${message.text || 'No text content'}"`;
        
        messages.push({
          role: 'assistant',
          content: `⚠️ PREVIOUSLY SENT MESSAGE (#${prevBotMessageCount}) using ${message.toolName || 'unknown tool'}:\n${sentMessage}\n\nDO NOT DUPLICATE THIS MESSAGE. The user already sees this message.`
        });
      }
    }
  }

  // Add the current user message if not already found in message history
  // IMPORTANT: Only add it if it wasn't already found in thread history
  if (context && context.text && !currentMessageFound) {
    console.log("Adding current message to context (wasn't found in message history)");
    
    let prefix = 'CURRENT USER REQUEST: ';
    
    messages.push({
      role: 'user',
      content: `${prefix}${context.text || 'No text content'}`
    });
  } else {
    console.log("Current user message already included in thread history, not adding again");
  }

  // Handle button clicks specially
  if (context && context.actionId) {
    // Add a clear notice about button clicks
    messages.push({
      role: 'system',
      content: `⚠️ IMPORTANT: The user clicked a button with action ID "${context.actionId}" and value "${context.actionValue}". 
Respond to this button click directly.

1. Do NOT create new buttons - the user has already made their choice
2. Use postMessage to acknowledge their selection
3. Provide a response based on their button choice
4. End the conversation turn with finishRequest`
    });
  }

  // Add a final reminder if we've already posted messages
  if (prevBotMessageCount > 0) {
    messages.push({
      role: 'system',
      content: `⚠️ FINAL WARNING: You have already sent ${prevBotMessageCount} message(s) in this conversation as shown above. 
DO NOT send duplicate messages or create similar button options. The user already sees your previous message(s).

If you already created buttons, DO NOT create more buttons or suggest options again.
The user is waiting for your existing message to be processed.`
    });
  }
  
  // Add previous tool executions to context (limited)
  // Use the getToolExecutionHistory method if available
  if (typeof threadState.getToolExecutionHistory === 'function') {
    const toolExecutionHistory = threadState.getToolExecutionHistory(3); // Just get last 3
    
    if (toolExecutionHistory.length > 0) {
      console.log(`Adding ${toolExecutionHistory.length} recent tool executions to context`);
      
      // Add only the most important tool calls
      for (const execution of toolExecutionHistory) {
        // Skip non-message tools
        if (execution.toolName !== 'postMessage' && 
            execution.toolName !== 'createButtonMessage' &&
            execution.toolName !== 'finishRequest') {
          continue;
        }
        
        // Add error information if present
        let functionContent = '';
        
        if (execution.error) {
          functionContent = `ERROR: ${execution.error.message}`;
        } else {
          functionContent = typeof execution.result === 'string' 
            ? execution.result 
            : JSON.stringify(execution.result, null, 2);
        }
        
        messages.push({
          role: 'function',
          name: execution.toolName,
          content: functionContent
        });
      }
    }
  }

  return messages;
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
    
    if (toolName === 'postMessage') {
      // For postMessage, show what was sent to the user
      formattedResponse = {
        message_sent: true,
        title: args.title,
        text: args.text ? (args.text.length > 100 ? args.text.substring(0, 100) + '...' : args.text) : null
      };
    } else if (toolName === 'getThreadHistory') {
      // For getThreadHistory, show summary of what was retrieved
      formattedResponse = {
        thread_history_retrieved: true,
        messages_count: response?.messagesRetrieved || 0,
        has_parent: response?.threadStats?.parentMessageRetrieved || false
      };
    } else if (toolName === 'finishRequest') {
      // For finishRequest, just confirm it was completed
      formattedResponse = {
        request_completed: true,
        summary: args.summary || "Request completed"
      };
    } else {
      // For other tools, simplify the response
      if (response && typeof response === 'object') {
        if (response.ok !== undefined) {
          // It's likely a Slack API response, simplify it
          formattedResponse = { success: true };
        } else {
          // Use the response as is, but ensure it's not overly complex
          formattedResponse = response;
        }
      } else {
        formattedResponse = response || { success: true };
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
 * Gets the system instructions for the LLM
 * @param {Object} context - Additional context to include in the instructions
 * @returns {string} - System instructions
 */
function getSystemInstructions(context) {
  const botUserID = context?.botUserID || 'YOUR_SLACK_BOT_ID';
  
  // Get registered tools for dynamically generating the tool list
  let toolsWithDetails = '';
  try {
    const registeredTools = getToolsForLLM();
    
    // Generate a more descriptive list of tools with their parameters
    if (registeredTools && registeredTools.length > 0) {
      toolsWithDetails = registeredTools.map(tool => {
        // Create a brief parameters description
        const paramsList = Object.entries(tool.parameters || {})
          .filter(([paramName]) => paramName !== 'reasoning') // Don't include reasoning
          .map(([paramName, description]) => {
            const isRequired = !description || !description.toLowerCase().includes('optional');
            return `    - ${paramName}${isRequired ? ' (required)' : ' (optional)'}: ${description || 'No description available'}`;
          })
          .join('\n');
          
        return `- ${tool.name}: ${tool.description || 'No description available'}\n  Parameters:\n${paramsList}`;
      }).join('\n\n');
    } else {
      // Fallback if tools aren't available
      toolsWithDetails = '- postMessage: Send a message to the user\n  Parameters:\n    - text (required): Message text content\n    - title (optional): Title for the message\n\n- finishRequest: End your turn in the conversation\n  Parameters:\n    - summary (required): Brief summary of completed action';
    }
  } catch (error) {
    console.log('Error getting tools for system instructions:', error.message);
    // Fallback if there's an error
    toolsWithDetails = '- postMessage: Send a message to the user\n  Parameters:\n    - text (required): Message text content\n    - title (optional): Title for the message\n\n- finishRequest: End your turn in the conversation\n  Parameters:\n    - summary (required): Brief summary of completed action';
  }
  
  return `You are Aya, a helpful assistant in Slack.

COMMUNICATION STYLE:
- Be friendly, helpful, and concise
- Use markdown formatting in your messages for readability
- Format code with \`\`\`language\n code \`\`\` blocks
- Sound natural and conversational

WORKFLOW:
1. When someone messages you, understand their request
2. Use available tools to respond appropriately 
3. Post your response in the thread using the postMessage tool
4. Use the finishRequest tool when you're done to signal completion
5. If errors occur, handle them gracefully without exposing technical details to users

⚠️ CRITICAL BEHAVIOR REQUIREMENTS (READ CAREFULLY) ⚠️:
1. YOU MUST ALWAYS USE TOOL CALLS - NEVER RESPOND WITH PLAINTEXT
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

AVAILABLE TOOLS:

${toolsWithDetails}

FORMAT REQUIREMENTS FOR TOOLS:
1. ALL tool calls must be in \`\`\`json code blocks
2. ALWAYS wrap tool calls in \`\`\`json code blocks
3. NEVER mix formats - use ONLY this format for ALL tool calls
4. NEVER prefix tool names with "functions." or any other namespace
5. EVERY tool call MUST include a reasoning parameter
6. Text outside tool calls is NOT sent to users
7. Send only ONE tool call per response - DO NOT include multiple tool calls
8. For a normal user interaction: first send postMessage, then after receiving a response, send finishRequest

TOOL CALLING FORMAT (YOU MUST USE THIS FORMAT FOR ALL RESPONSES):
Use this exact JSON format for EACH tool call (send only one at a time):
\`\`\`json
{
  "tool": "toolName",
  "parameters": {
    "param1": "value1",
    "param2": "value2",
    "reasoning": "Brief explanation of why you're using this tool"
  }
}
\`\`\`

IMPORTANT: ALWAYS include a "tool" field and a "parameters" object with a "reasoning" field.

DO NOT use any other format for tool calls. ONLY use the format shown above.

MESSAGE FORMATTING GUIDELINES:
Create well-formatted messages using these abstracted elements instead of raw Slack blocks:
- title: Add a main heading to your message
- text: Your main message content with markdown support
- subtitle: Optional smaller text below the title
- color: Message accent color (blue, green, red, orange, purple or hex code)
- elements: Rich formatting elements like:
  * { type: 'header', text: 'Section Header' }
  * { type: 'divider' }
  * { type: 'bullet_list', items: ['Item 1', 'Item 2', 'Item 3'] }
  * { type: 'numbered_list', items: ['Step 1', 'Step 2', 'Step 3'] }
  * { type: 'quote', text: 'Important quote text' }
  * { type: 'code', language: 'javascript', code: 'const x = 1;' }
  * { type: 'context', text: 'Additional information' }
- fields: For structured data as [{ title: 'Field name', value: 'Field value' }]
- actions: For basic buttons without tracking as [{ text: 'Button Text', value: 'button_value' }]

EXAMPLES OF CORRECT TOOL USAGE SEQUENCE:

Example 1: First send a message to the user:
\`\`\`json
{
  "tool": "postMessage",
  "parameters": {
    "title": "Hello there!",
    "text": "I'm happy to help you today. What can I do for you?",
    "color": "blue",
    "reasoning": "Responding to the user's greeting"
  }
}
\`\`\`

Wait for this tool call to complete before sending another one.

Example 2: After the postMessage completes, send a finishRequest:
\`\`\`json
{
  "tool": "finishRequest",
  "parameters": {
    "summary": "Responded to user's question about Slack APIs",
    "reasoning": "The conversation is complete for this turn"
  }
}
\`\`\`

⚠️ REMEMBER (CRITICAL): 
- YOU MUST ALWAYS USE TOOL CALLS - NEVER RESPOND WITH PLAINTEXT
- All your responses to users MUST go through the postMessage tool 
- Send only ONE tool call at a time - DO NOT send multiple tool calls in the same response
- Wait for each tool call to complete before sending another one
- After sending a postMessage, always send a finishRequest to complete the interaction`;
}

/**
 * Parses the tool call from the LLM response
 * @param {Object} llmResponse - The response from the LLM
 * @returns {Object} - The parsed tool call
 */
async function parseToolCallFromResponse(llmResponse) {
  try {
    // Log the format we're detecting
    console.log("Tool call format: Using native OpenAI tool_calls format");

    // Get the assistant's message
    const assistantMessage = llmResponse.choices[0].message;
    if (!assistantMessage) {
      throw new Error('No assistant message found in response');
    }

    // Handle native OpenAI tool_calls format
    if (assistantMessage.tool_calls && Array.isArray(assistantMessage.tool_calls)) {
      const toolCalls = [];
      
      // Extract each tool call
      for (const toolCall of assistantMessage.tool_calls) {
        const toolName = toolCall.function.name;
        console.log(`Tool call from LLM: ${toolName} -> Converted to: ${toolName}`);
        
        // Parse the function arguments
        let parameters;
        try {
          // First clean up the arguments by removing any code block formatting
          let cleanedArgs = toolCall.function.arguments;
          
          // Clean any markdown code blocks that might be present
          if (cleanedArgs.includes("```")) {
            // Extract just the JSON content between code block markers
            const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
            const match = codeBlockRegex.exec(cleanedArgs);
            if (match && match[1]) {
              cleanedArgs = match[1].trim();
            } else {
              // If regex didn't find code blocks but they exist, use a simpler approach
              cleanedArgs = cleanedArgs.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            }
            console.log("Removed code block formatting from arguments");
          }
          
          // Now try to parse the cleaned arguments
          parameters = JSON.parse(cleanedArgs);
          
          // Log successful parsing
          console.log("Successfully parsed tool parameters");
        } catch (parseError) {
          console.log(`Error parsing tool parameters: ${parseError}`);
          
          // Special handling for malformed JSON - attempt to clean and extract
          const argsText = toolCall.function.arguments;
          
          // Try to detect if there's a markdown code block present
          if (argsText.includes("```json") || argsText.includes("```")) {
            console.log("Detected code block in arguments - attempting cleanup");
            
            // Remove code block formatting first
            const cleanedArgs = argsText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            
            // Extract the JSON object/array
            const jsonStart = Math.max(cleanedArgs.indexOf("{"), cleanedArgs.indexOf("["));
            const jsonEnd = Math.max(cleanedArgs.lastIndexOf("}"), cleanedArgs.lastIndexOf("]"));
            
            if (jsonStart >= 0 && jsonEnd >= 0) {
              const extractedJson = cleanedArgs.substring(jsonStart, jsonEnd + 1);
              
              try {
                // Try to parse the extracted content
                const extractedParams = JSON.parse(extractedJson);
                
                // Check if this is a nested tool specification rather than just parameters
                if (extractedParams.tool && extractedParams.parameters) {
                  parameters = extractedParams.parameters;
                  console.log(`Found nested tool call format: ${extractedParams.tool}`);
                } else {
                  parameters = extractedParams;
                }
                
                console.log("Successfully extracted parameters from code block");
              } catch (extractError) {
                console.log(`Error parsing extracted JSON: ${extractError}`);
                
                // Last resort - try to find and extract individual parameters
                try {
                  // Look for a title in quotes
                  const titleMatch = cleanedArgs.match(/"title":\s*"([^"]+)"/);
                  const textMatch = cleanedArgs.match(/"text":\s*"([^"]+)"/);
                  
                  parameters = {
                    title: titleMatch ? titleMatch[1] : "Options",
                    text: textMatch ? textMatch[1] : "Please select an option:",
                    reasoning: "Parameters extracted from malformed JSON"
                  };
                  
                  // Try to extract buttons if present
                  const buttonsMatch = cleanedArgs.match(/"buttons":\s*(\[\s*\{[^\]]+\]\s*)/);
                  if (buttonsMatch) {
                    try {
                      // Try to clean and parse the buttons array
                      const buttonsStr = buttonsMatch[1].replace(/'/g, '"').trim();
                      const cleanedButtonsStr = buttonsStr.replace(/,\s*\]$/, ']'); // Fix trailing commas
                      
                      const buttons = JSON.parse(cleanedButtonsStr);
                      if (Array.isArray(buttons)) {
                        parameters.buttons = buttons;
                      }
                    } catch (btnError) {
                      console.log(`Failed to parse buttons array: ${btnError}`);
                      // Default buttons
                      parameters.buttons = [
                        { text: "Option 1", value: "option1" },
                        { text: "Option 2", value: "option2" }
                      ];
                    }
                  }
                  
                  console.log("Created fallback parameters from text extraction");
                } catch (fallbackError) {
                  console.log(`Fallback extraction failed: ${fallbackError}`);
                  parameters = { 
                    text: "I couldn't process that correctly. Here are some options:", 
                    reasoning: "Parameter parsing failed completely" 
                  };
                }
              }
            } else {
              // Default parameters if JSON boundaries not found
              parameters = { 
                text: "Here are some options:", 
                reasoning: "Failed to find valid JSON in the tool call" 
              };
            }
          } else {
            // No code blocks, but still failed to parse
            parameters = { 
              text: "Here are some options:", 
              reasoning: "Parameter parsing failed" 
            };
          }
        }
        
        // Always ensure there's a reasoning parameter
        if (!parameters.reasoning) {
          parameters.reasoning = "Auto-generated reasoning for tool call";
        }
        
        toolCalls.push({
          tool: toolName,
          parameters
        });
      }
      
      console.log(`Successfully extracted ${toolCalls.length} tool calls from native format`);
      return { toolCalls };
    } else {
      // Handle case where tool calls aren't present
      console.log("No tool_calls found in response. Checking for content to use as postMessage");
      
      // Default to a postMessage with the content
      if (assistantMessage.content) {
        return {
          toolCalls: [{
            tool: 'postMessage',
            parameters: {
              text: assistantMessage.content,
              reasoning: "Converting regular message to tool call"
            }
          }]
        };
      } else {
        throw new Error('No content or tool calls found in response');
      }
    }
  } catch (error) {
    console.log(`Error parsing tool call: ${error.message}`);
    throw error;
  }
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
                    console.log('Parsing buttons parameter from JSON string to array');
                    processedParams.buttons = JSON.parse(processedParams.buttons);
                } catch (error) {
                    console.log(`Error parsing buttons parameter: ${error.message}`);
                }
            }
            break;
            
        case 'updateMessage':
            // Handle fields parameter for updateMessage
            if (typeof processedParams.fields === 'string') {
                try {
                    console.log('Parsing fields parameter from JSON string to array');
                    processedParams.fields = JSON.parse(processedParams.fields);
                } catch (error) {
                    console.log(`Error parsing fields parameter: ${error.message}`);
                }
            }
            break;
            
        case 'createEmojiVote':
            // Handle options parameter for createEmojiVote
            if (typeof processedParams.options === 'string') {
                try {
                    console.log('Parsing options parameter from JSON string to array');
                    processedParams.options = JSON.parse(processedParams.options);
                } catch (error) {
                    console.log(`Error parsing options parameter: ${error.message}`);
                }
            }
            break;
            
        // Add other tools as needed
    }
    
    return processedParams;
}

/**
 * Gets the available tools in the format the LLM expects
 * @returns {Array} - Array of tool definitions
 */
function getAvailableTools() {
  // Get tools from registry with their metadata
  const registeredTools = getToolsForLLM();
  
  // Transform to the format expected by the LLM API
  return registeredTools.map(tool => {
    // Create properties object from parameters
    const properties = {};
    const required = [];
    
    // Add parameters as properties
    Object.entries(tool.parameters).forEach(([paramName, description]) => {
      // If description doesn't contain "optional", add to required
      if (!description.toLowerCase().includes('optional')) {
        required.push(paramName);
      }
      
      // Determine if this parameter should be an array or object based on name and description
      let paramType = 'string';
      let paramFormat = null;
      
      // Check if parameter is likely an array based on name or description
      if (paramName === 'buttons' || 
          paramName === 'options' || 
          paramName === 'fields' || 
          paramName === 'elements' || 
          paramName === 'items' ||
          (description && description.toLowerCase().includes('array'))) {
        paramType = 'array';
      }
      // Check if parameter is likely an object based on name or description
      else if (paramName === 'metadata' || 
               paramName === 'context' || 
               paramName === 'config' ||
               (description && description.toLowerCase().includes('object'))) {
        paramType = 'object';
      }
      
      // Create the parameter definition with appropriate type
      if (paramType === 'array') {
        properties[paramName] = {
          type: 'array',
          description: description,
          items: {
            type: 'object'
          }
        };
      } else if (paramType === 'object') {
        properties[paramName] = {
          type: 'object',
          description: description
        };
      } else {
        properties[paramName] = {
          type: 'string',
          description: description
        };
      }
    });
    
    // Add reasoning parameter to all tools
    properties.reasoning = {
      type: 'string',
      description: 'Explain briefly why you are using this tool. This field is required for all tool calls.'
    };
    
    // Reasoning should always be required
    if (!required.includes('reasoning')) {
      required.push('reasoning');
    }
    
    // Use a format that matches our custom JSON format more closely
    // This helps prevent the model from adding "functions." prefix
    return {
      type: 'function',
      function: {
        // The key change: Use a name that doesn't suggest a "functions." namespace
        name: tool.name, // Do not change this as it's used for tool lookup
        description: tool.description,
        parameters: {
          type: 'object',
          properties: properties,
          required: required
        }
      }
    };
  });
}

module.exports = {
  getNextAction,
  processJsonStringParameters
};