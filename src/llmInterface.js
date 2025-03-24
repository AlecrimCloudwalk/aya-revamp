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

    // Format the messages for the LLM
    const messages = formatMessagesForLLM(threadState);
    
    // Log the messages we're sending to the LLM in a developer-friendly way
    console.log("\n🧠 SENDING REQUEST TO LLM");
    console.log(`Model: ${LLM_MODEL}`);
    
    if (messages.length > 0) {
      console.log(`\nContext items: ${messages.length}`);
      // We've already logged the full context in formatMessagesForLLM
      console.log("-> See CONVERSATION CONTEXT SENT TO LLM above for details");
      console.log("Sending request...");
    }
    
    // Build the complete LLM request
    const requestBody = {
      model: LLM_MODEL,
      messages,
      temperature: 0.2,
      top_p: 0.95,
      frequency_penalty: 0,
      presence_penalty: 0,
      tools: getAvailableTools(),
      tool_choice: "auto"  // Allow model to choose which tool is appropriate
    };

    // Make the API request to the LLM
    return await sendRequestToLLM(requestBody, threadState);
  } catch (error) {
    console.log(`\n❌ LLM ERROR ❌`);
    console.log(`Message: ${error.message}`);
    console.log("--------------------------------");
    
    // Handle and log any errors
    logError('Error getting next action from LLM', error, { threadState });
    
    // Rethrow the error for the orchestrator to handle
    // This is better than creating a tool call here - let the LLM decide how to communicate errors
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
 * @param {Object} context - The thread context
 * @returns {string} - The system message
 */
function getSystemMessage(context) {
  // Create a system message with instructions and context
  let systemMessage = `Hi there! You're Aya, a helpful AI assistant in Slack. This is a conversation between you and users. You have special tools you can use to interact with Slack.

IMPORTANT CONTEXT:
You're in a ${context.isDirectMessage ? 'direct message' : 'thread'} in Slack ${context.isThreadedConversation ? 'with multiple messages' : ''}.
User ID: ${context.userId}
Channel: ${context.channelId}${context.threadTs ? `\nThread: ${context.threadTs}` : ''}
${context.isCommand ? `The user used a command: ${context.commandName || 'unknown'}` : ''}`;

  // Add thread statistics if available
  if (context.threadTs && context.threadStats) {
    systemMessage += `\n\nTHREAD INFO:
- There are ${context.threadStats.totalMessagesInThread} total messages in this thread
- The parent message (first message of the thread) is ${context.threadStats.hasParentMessage ? 'included in your context' : 'not in your context'}
- This thread might contain task context in its parent message`;
  }
  
  systemMessage += `\n\nYOUR TOOLS:
1. postMessage - Use this to send a message to the user in Slack
   Example: When the user asks a question, call postMessage to answer them

2. finishRequest - Call this when you've completed responding to the user
   Example: After answering a question, call finishRequest to end that conversation turn

3. getThreadHistory - Use this if you're missing context from earlier in the thread
   Example: If the user refers to something you don't know about, get the thread history

Each tool requires a brief "reasoning" field explaining why you're using it. This helps with debugging.

CONVERSATION FLOW:
- When a user sends a message, you typically respond with postMessage
- Then call finishRequest to finish your turn
- For complex conversations, you might need multiple messages before finishing
- Only call getThreadHistory if the user refers to something you don't have context for

VERY IMPORTANT: TOOL CALL FORMAT
When you need to call a tool, use ONLY this format:

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

IMPORTANT RULES:
1. Send only ONE tool call at a time
2. Wait for each tool to complete before sending another
3. For normal interactions: first send postMessage, then after that completes, send finishRequest
4. DO NOT include multiple tool calls in one response
5. Text outside the JSON code blocks will not be sent to the user

Make sure to include a JSON code block with a "tool" property and a "parameters" object. This format is required for the system to process your tool calls correctly.

Remember, you're having a natural conversation. Don't repeat yourself or send the same message multiple times.

Below you'll see the conversation history. Read through it to understand the context before deciding what to do next.`;

  return systemMessage;
}

/**
 * Formats the messages for the LLM API based on thread state
 * @param {Object} threadState - Current thread state
 * @returns {Array} - Formatted messages for the LLM
 */
function formatMessagesForLLM(threadState) {
  const messages = [];
  
  // Add system message
  const systemMessage = getSystemInstructions(threadState.context);
  messages.push({
    role: 'system',
    content: systemMessage,
  });

  // Debug logging of context
  console.log(`\n---- Building Context for LLM ----`);
  console.log(`Thread Stats: ${threadState.context.threadStats ? 
    `${threadState.context.threadStats.totalMessagesInThread} total messages, ${threadState.messages?.length || 0} in context` : 
    'Not available'}`);
  console.log(`Context includes: ${threadState.messages?.filter(m => m.isUser).length || 0} user messages, ${threadState.messages?.filter(m => !m.isUser).length || 0} bot messages, ${threadState.toolResults?.length || 0} tool call results`);
  
  // Check if this is for a button click
  const isButtonClick = !!threadState.context.currentButtonClick;
  if (isButtonClick) {
    console.log(`Building context for button click: ${threadState.context.currentButtonClick.buttonSignature}`);
  }
  
  // Format thread messages if present
  if (threadState.messages && threadState.messages.length > 0) {
    console.log(`Thread history: ${threadState.messages.length} messages being imported`);
    
    for (const message of threadState.messages) {
      let prefix = '';
      let positionDisplay = '';
      
      // Include chronological position if available
      if (message.threadPosition) {
        positionDisplay = ` [MESSAGE #${message.threadPosition}]`;
      }

      if (message.isParentMessage) {
        prefix = `THREAD PARENT MESSAGE${positionDisplay}:\n`;
      } else if (message.isButtonClick) {
        // Special formatting for button clicks
        prefix = `BUTTON INTERACTION${positionDisplay}:\n`;
      } else {
        prefix = `THREAD REPLY${positionDisplay}:\n`;
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
      } else {
        // For bot messages, try to find the associated tool call
        let toolCallInfo = '';
        
        // Check if this message was generated by a tool call
        if (message.fromTool && threadState.toolResults) {
          // Find the related tool execution that generated this message
          const relatedToolResult = threadState.toolResults.find(tr => 
            tr.requestId === message.requestId && tr.toolName === 'postMessage'
          );
          
          if (relatedToolResult) {
            toolCallInfo = ` (from postMessage tool call #${threadState.toolResults.indexOf(relatedToolResult) + 1})`;
          }
        }
        
        messages.push({
          role: 'assistant',
          content: `${prefix}YOUR PREVIOUS RESPONSE${toolCallInfo}: ${message.text || 'No text content'}`
        });
      }
    }
  }

  // Add the current user message that triggered this interaction
  if (threadState.context.currentMessage) {
    // Determine position display for current message
    let positionDisplay = '';
    if (threadState.context.currentMessage.threadPosition) {
      positionDisplay = ` [MESSAGE #${threadState.context.currentMessage.threadPosition}]`;
    }
    
    let prefix = '';
    if (threadState.context.isThreadedConversation) {
      prefix = `CURRENT THREAD REPLY${positionDisplay}:\n`;
    } else if (threadState.context.isDirectMessage) {
      prefix = `DIRECT MESSAGE${positionDisplay}:\n`;
    } else {
      prefix = `CHANNEL MESSAGE${positionDisplay}:\n`;
    }
    
    messages.push({
      role: 'user',
      content: `${prefix}USER MESSAGE: ${threadState.context.currentMessage.text || 'No text content'}`
    });
  }

  // If this is a button click, add a special message to clarify
  if (isButtonClick) {
    // Find the button click message
    const buttonClickMessage = threadState.messages.find(
      m => m.buttonClickId === threadState.context.currentButtonClick.buttonSignature
    );
    
    if (buttonClickMessage && buttonClickMessage.buttonInfo) {
      // Add more detailed button information for better context
      messages.push({
        role: 'system',
        content: `IMPORTANT: The user clicked a button. Please respond to this action using the standard tool call format. 
Button details: 
- Text: "${buttonClickMessage.buttonInfo.text || buttonClickMessage.buttonInfo.value}"
- Value: "${buttonClickMessage.buttonInfo.value}"
- Action ID: "${buttonClickMessage.buttonInfo.actionId}"

The button has been visually updated in the UI to show it was selected. You should now:
1. Use the postMessage tool to confirm the user's selection
2. Include an acknowledgment of their choice in your message
3. Proceed with the next step based on their selection
4. DO NOT ask the user to click the button again - they already did
5. Use the finishRequest tool after your response

IMPORTANT: Use the same JSON format in \`\`\`json code blocks as in your other responses.
DO NOT change your response format - use the standard postMessage and finishRequest tools.`
      });
    } else {
      messages.push({
        role: 'system',
        content: `IMPORTANT: The user clicked a button. Respond directly to this button click.

1. Use the postMessage tool to acknowledge their selection
2. Include a brief confirmation of what was selected
3. Continue with your normal tool call format, using the JSON format in code blocks
4. Remember to use finishRequest when you're done`
      });
    }
  }

  // Add previous tool calls if any
  if (threadState.toolResults && threadState.toolResults.length > 0) {
    console.log(`Adding ${threadState.toolResults.length} tool results to context`);
    
    // First organize tool results in chronological order
    const sortedToolResults = [...threadState.toolResults].sort((a, b) => {
      return new Date(a.timestamp) - new Date(b.timestamp);
    });
    
    // Group by requestId to show logical flow
    const requestGroups = {};
    for (const result of sortedToolResults) {
      const requestId = result.requestId || 'unknown';
      if (!requestGroups[requestId]) {
        requestGroups[requestId] = [];
      }
      requestGroups[requestId].push(result);
    }
    
    // Add each group's tool results in order
    let resultCounter = 1;
    for (const requestId of Object.keys(requestGroups)) {
      const results = requestGroups[requestId];
      
      if (results.length > 0) {
        messages.push({
          role: 'system',
          content: `--- Tool execution sequence #${resultCounter++} ---`
        });
      }
      
      for (const toolCall of results) {
        // Skip duplicate tools that weren't actually executed
        if (toolCall.duplicate) {
          continue;
        }
        
        // Format the message for the function result
        let functionContent = typeof toolCall.response === 'string' 
          ? toolCall.response 
          : JSON.stringify(toolCall.response, null, 2);
        
        // For postMessage, add a note about the message being sent to the user
        if (toolCall.toolName === 'postMessage' && !toolCall.error) {
          functionContent = `MESSAGE SENT TO USER: ${functionContent}`;
        }
        
        messages.push({
          role: 'function',
          name: toolCall.toolName,
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

CRITICAL BEHAVIOR REQUIREMENTS:
1. NEVER send more than one message per user request unless explicitly needed
2. ALWAYS call finishRequest after sending your response
3. NEVER repeat a postMessage with the same content
4. ALWAYS check if you've already responded before sending a new message
5. Each user message should get exactly ONE response from you
6. NEVER include raw code or function calls in your message content
7. ALWAYS use the standardized JSON format for tool calls as shown below
8. ALWAYS respond on your first iteration with a properly-formatted tool call
9. IMPORTANT: Text written outside of tool calls will NOT be shown to the user
10. ALL your responses to users MUST go through the postMessage tool
11. SEND ONLY ONE TOOL CALL AT A TIME - Do not include multiple tool calls in one response

FORMAT REQUIREMENTS FOR TOOLS:
1. ALL tool calls must be in \`\`\`json code blocks
2. ALWAYS wrap tool calls in \`\`\`json code blocks
3. NEVER mix formats - use ONLY this format for ALL tool calls
4. NEVER prefix tool names with "functions." or any other namespace
5. EVERY tool call MUST include a reasoning parameter
6. Text outside tool calls is NOT sent to users
7. Send only ONE tool call per response - DO NOT include multiple tool calls
8. For a normal user interaction: first send postMessage, then after receiving a response, send finishRequest

TOOL CALLING FORMAT:
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

REMEMBER: 
- All your responses to users MUST go through the postMessage tool 
- Send only ONE tool call at a time - DO NOT send multiple tool calls in the same response
- Wait for each tool call to complete before sending another one
- After sending a postMessage, always send a finishRequest to complete the interaction`;
}

/**
 * Parses the LLM response to extract tool calls from our custom JSON format
 * @param {Object} llmResponse - Response from the LLM API
 * @returns {Object} - Parsed tool calls and other message content
 */
async function parseToolCallFromResponse(llmResponse) {
  try {
    const response = llmResponse;
    const choices = response.choices || [];
    
    if (choices.length === 0) {
      return { toolCalls: [], content: '' };
    }
    
    // Get the first (and typically only) choice
    const firstChoice = choices[0];
    const message = firstChoice.message || {};
    let content = message.content || '';
    
    // Array to store extracted tool calls
    const extractedToolCalls = [];
    
    // OpenAI might still use its native format, handle both
    const nativeToolCalls = message.tool_calls || [];
    let hasNativeCalls = nativeToolCalls.length > 0;
    
    // Process any native tool calls (for backward compatibility)
    if (hasNativeCalls) {
      console.log("Tool call format: Using native OpenAI tool_calls format");
      
      for (const toolCall of nativeToolCalls) {
        if (toolCall.function && toolCall.function.name) {
          // Remove any "functions." prefix from the tool name
          const toolName = toolCall.function.name.replace(/^functions\./, '');
          
          extractedToolCalls.push({
            id: toolCall.id || `native_${Date.now()}`,
            tool: toolName,
            parameters: JSON.parse(toolCall.function.arguments || '{}')
          });
        }
      }
    }
    
    // Look for tool calls in code blocks in the content
    if (content) {
      // Improved regex to capture JSON code blocks more reliably
      // This handles both ```json and ``` format
      const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
      let match;
      let matchCount = 0;
      
      while ((match = jsonBlockRegex.exec(content)) !== null) {
        try {
          matchCount++;
          const jsonString = match[1].trim();
          
          // Skip empty blocks
          if (!jsonString) {
            console.log("Empty JSON code block found, skipping");
            continue;
          }
          
          // Parse the JSON
          const jsonData = JSON.parse(jsonString);
          
          // Check if this is a valid tool call
          if (jsonData.tool && typeof jsonData.parameters === 'object') {
            console.log(`Found JSON tool call in code block: ${jsonData.tool}`);
            
            // Add this to the extracted tool calls
            extractedToolCalls.push({
              id: `json_block_${extractedToolCalls.length + 1}`,
              tool: jsonData.tool,
              parameters: jsonData.parameters
            });
            
            // Replace the code block with nothing to avoid duplicate processing
            content = content.replace(match[0], '');
          } else {
            console.log(`Found JSON in code block but it doesn't match tool call format:`, jsonData);
          }
        } catch (e) {
          console.log(`Error parsing JSON from code block: ${e.message}`);
          // Log the problematic match for debugging
          console.log(`Problematic JSON: ${match[1].substring(0, 50)}...`);
        }
      }
      
      if (matchCount > 0) {
        console.log(`Tool call format: Found ${matchCount} JSON code blocks`);
      }
    }
    
    // Check for mixed formats and log warning
    if (hasNativeCalls && extractedToolCalls.length > nativeToolCalls.length) {
      console.log("⚠️ CRITICAL WARNING: LLM is mixing tool call formats (native and JSON blocks)");
      console.log("This can lead to duplicate messages and unexpected behavior");
      console.log("Suggestion: Update system instructions to clarify format requirements");
    }
    
    // Check for duplicate tool calls and remove them
    const uniqueToolCalls = [];
    const seenCalls = new Map();
    
    for (const call of extractedToolCalls) {
      // Create a signature for the tool call based on tool name and parameters
      const signature = `${call.tool}:${JSON.stringify(call.parameters)}`;
      
      if (!seenCalls.has(signature)) {
        seenCalls.set(signature, true);
        uniqueToolCalls.push(call);
      } else {
        console.log(`⚠️ Removing duplicate tool call for ${call.tool}`);
      }
    }
    
    // Replace extractedToolCalls with the deduplicated version
    const deduplicatedCount = extractedToolCalls.length - uniqueToolCalls.length;
    if (deduplicatedCount > 0) {
      console.log(`Removed ${deduplicatedCount} duplicate tool calls`);
      extractedToolCalls.length = 0;
      extractedToolCalls.push(...uniqueToolCalls);
    }
    
    // Log tool call detection summary
    console.log(`Tool call format detection: Native OpenAI: ${hasNativeCalls ? 'YES' : 'NO'}, JSON blocks: ${extractedToolCalls.length > 0 ? 'YES' : 'NO'}`);
    
    console.log("\n=== LLM RESPONSE ===");
    console.log(`Model: ${response.model}`);
    console.log("");
    
    // Log content if present
    if (content && content.trim()) {
      console.log(`Content: ${content}`);
      console.log("");
    }
    
    // Log extracted tool calls
    if (extractedToolCalls.length > 0) {
      console.log("Tool Calls:");
      for (let i = 0; i < extractedToolCalls.length; i++) {
        const toolCall = extractedToolCalls[i];
        console.log(`  [${i + 1}] ${toolCall.tool}`);
        console.log(`      Parameters: ${JSON.stringify(toolCall.parameters, null, 2)}`);
        console.log("");
      }
    }
    
    // Log usage statistics
    if (response.usage) {
      console.log(`Completion Tokens: ${response.usage.completion_tokens}`);
      console.log(`Total Tokens: ${response.usage.total_tokens}`);
    }
    
    console.log("===================\n");
    
    // If there is content but no tool calls, log a warning
    if (extractedToolCalls.length === 0 && content && content.trim()) {
      console.log("⚠️ WARNING: LLM returned content without tool calls");
      console.log("The LLM should be using the JSON tool call format in code blocks");
      
      // Try harder to extract any JSON-like structure - a more forgiving fallback
      try {
        // This is a fallback for when the LLM formats JSON incorrectly 
        // or doesn't use proper code blocks
        const jsonPattern = /{[\s\S]*?"tool"[\s\S]*?:[\s\S]*?"[^"]*"[\s\S]*?,[\s\S]*?"parameters"[\s\S]*?:[\s\S]*?{[\s\S]*?}[\s\S]*?}/g;
        const matches = content.match(jsonPattern);
        
        if (matches && matches.length > 0) {
          console.log("Attempting fallback extraction of tool calls from malformed JSON");
          
          for (const match of matches) {
            try {
              const jsonData = JSON.parse(match);
              
              if (jsonData.tool && typeof jsonData.parameters === 'object') {
                console.log(`Fallback extraction: Found tool call for ${jsonData.tool}`);
                
                // Check for duplicates before adding
                const signature = `${jsonData.tool}:${JSON.stringify(jsonData.parameters)}`;
                if (!seenCalls.has(signature)) {
                  seenCalls.set(signature, true);
                  extractedToolCalls.push({
                    id: `fallback_${extractedToolCalls.length + 1}`,
                    tool: jsonData.tool,
                    parameters: jsonData.parameters
                  });
                } else {
                  console.log(`⚠️ Skipping duplicate fallback tool call for ${jsonData.tool}`);
                }
              }
            } catch (e) {
              console.log(`Fallback extraction failed: ${e.message}`);
            }
          }
        }
      } catch (fallbackError) {
        console.log(`Fallback extraction error: ${fallbackError.message}`);
      }
    }
    
    // Return the processed data
    return {
      toolCalls: extractedToolCalls,
      content,
      model: response.model
    };
  } catch (error) {
    logError('Error parsing tool call from LLM response', error);
    return { toolCalls: [], content: '' };
  }
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
      
      // Add as property (simple string type for now)
      properties[paramName] = {
        type: 'string',
        description: description
      };
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
  getNextAction
}; 