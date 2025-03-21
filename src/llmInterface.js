// Interface for communicating with the LLM
const { LLM_API_KEY, LLM_API_URL, LLM_MODEL } = require('./config.js');
const { logError, formatErrorForLLM } = require('./errors.js');
const fetch = require('node-fetch');

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
    const botError = logError('Error getting next action from LLM', error, { threadState });
    
    // If we encounter an error, we can use a fallback approach:
    // Return a postMessage tool call to inform the user about the issue
    return {
      toolName: 'postMessage',
      toolArgs: {
        title: 'Error Communicating with AI',
        text: `I'm having trouble processing your request. ${error.message}`,
        color: '#E81123'
      }
    };
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
      } else {
        prefix = `THREAD REPLY${positionDisplay}:\n`;
      }

      // Determine if message is from the bot or a user
      if (message.isUser) {
        messages.push({
          role: 'user',
          content: `${prefix}USER MESSAGE: ${message.text || 'No text content'}`
        });
      } else {
        messages.push({
          role: 'assistant',
          content: `${prefix}YOUR PREVIOUS RESPONSE: ${message.text || 'No text content'}`
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

  // Add previous tool calls if any
  if (threadState.toolResults && threadState.toolResults.length > 0) {
    for (const toolCall of threadState.toolResults) {
      messages.push({
        role: 'function',
        name: toolCall.toolName,
        content: typeof toolCall.response === 'string' ? toolCall.response : JSON.stringify(toolCall.response, null, 2)
      });
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
 * Creates clear system instructions for the LLM
 * @param {Object} context - The thread context
 * @returns {string} - The system instructions
 */
function getSystemInstructions(context) {
  // Create clear basic instructions
  let systemMessage = `You are Aya, a helpful AI assistant for Slack. You help users by answering questions and performing tasks.

=== THREAD CONTEXT ===
- Chat Type: ${context.isDirectMessage ? 'Direct Message' : context.isThreadedConversation ? 'Thread' : 'Channel Message'}
- User: ${context.userId}
- Channel: ${context.channelId}${context.threadTs ? `\n- Thread: ${context.threadTs}` : ''}
`;

  // Add thread statistics if available
  if (context.threadTs && context.threadStats) {
    systemMessage += `- Total Messages in Thread: ${context.threadStats.totalMessagesInThread}
- Parent Message Available: ${context.threadStats.hasParentMessage ? 'Yes' : 'No'}
- Recent Messages: ${context.threadStats.totalMessagesInThread <= 10 ? 'All included below' : 'First 10 included below (oldest messages)'}
`;
  }

  // Add command context if applicable
  if (context.isCommand) {
    systemMessage += `- Command Used: ${context.commandName || 'unknown'}\n`;
  }
  
  // Add tool documentation and workflow with distinctive function names
  systemMessage += `
=== MESSAGE NUMBERING ===
- Messages are numbered chronologically with [MESSAGE #X] indicating position in the thread
- Message #1 is always the first/parent message in the thread
- Higher numbers (e.g., #2, #3, etc.) are replies in chronological order
- When asked about the "second message" or "third message", refer to the explicit numbering
- This helps with accurate message references regardless of what messages are shown in the context

=== YOUR AVAILABLE TOOLS ===

1. !function.postMessage
   Purpose: Send a message to the user in Slack
   When to use: To respond to the user's message
   Required parameters: title, text, reasoning

2. !function.finishRequest
   Purpose: End your turn in the conversation
   When to use: After you've fully responded to the user's request
   Required parameters: reasoning

3. !function.getThreadHistory
   Purpose: Get additional messages from the thread if you need more context
   When to use: When you need more than the 10 most recent messages
   Required parameters: reasoning, maxMessages (optional)

=== CONVERSATION FLOW ===
1. User sends you a message
2. You analyze what they need
3. You respond using !function.postMessage (ONCE per request)
4. You MUST complete your turn with !function.finishRequest
5. If you need more context beyond what's provided, use !function.getThreadHistory

=== THREAD HISTORY ===
- You automatically receive up to 10 of the oldest messages in the thread
- If a thread has more than 10 messages and you need to see more recent ones, use !function.getThreadHistory
- The parent/first message of the thread is always included, as it typically contains important context

=== IMPORTANT NOTES ===
- Always include 'reasoning' in your tool calls to explain your decision
- NEVER send multiple messages or repeat yourself
- NEVER respond to the same user message more than once
- Pay careful attention to [YOUR PREVIOUS RESPONSE] markers in messages
- Look through all previous messages before responding to ensure you don't repeat yourself
- If you see your own previous message addressing the user's query, use !function.finishRequest instead of responding again
- After sending a response with !function.postMessage, you MUST call !function.finishRequest immediately
- You can mention users with <@USER_ID> format (e.g., <@${context.userId}>) to address them directly
- Check message timestamps and request IDs to understand the timeline of the conversation

The conversation history follows below with clear markers for USER MESSAGES and YOUR PREVIOUS RESPONSES.`;

  return systemMessage;
}

/**
 * Parses the LLM response to extract the tool call
 * @param {Object} llmResponse - The raw LLM API response
 * @returns {Promise<{toolName: string, toolArgs: Object}>} - The parsed tool call {toolName, toolArgs}
 */
async function parseToolCallFromResponse(llmResponse) {
  try {
    // Create a more developer-friendly log of the LLM response
    const assistantMessage = llmResponse.choices[0]?.message;
    console.log("\n=== LLM RESPONSE ===");
    console.log("Model:", llmResponse.model || "unknown");
    
    if (assistantMessage?.content) {
      console.log("\nContent:", assistantMessage.content);
    }
    
    if (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0) {
      console.log("\nTool Calls:");
      assistantMessage.tool_calls.forEach((tool, index) => {
        console.log(`  [${index + 1}] ${tool.function.name}`);
        try {
          const args = JSON.parse(tool.function.arguments);
          console.log(`      Arguments: ${JSON.stringify(args, null, 2)}`);
        } catch (e) {
          console.log(`      Arguments: ${tool.function.arguments}`);
        }
      });
    } else {
      console.log("\nNo tool calls in response");
    }
    
    console.log("\nCompletion Tokens:", llmResponse.usage?.completion_tokens || "unknown");
    console.log("Total Tokens:", llmResponse.usage?.total_tokens || "unknown");
    console.log("===================\n");
    
    // Check for empty or undefined response
    if (!llmResponse || !llmResponse.choices || !llmResponse.choices.length) {
      throw new Error('Empty or invalid LLM response received');
    }
    
    // Check for tool calls in newer API format
    if (!assistantMessage) {
      throw new Error('No assistant message found in LLM response');
    }
    
    const toolCalls = assistantMessage?.tool_calls || [];
    const content = assistantMessage?.content;
    
    // Check if there are tool calls in the content field
    // This handles cases where the LLM formats tool calls improperly
    // like "## functions.toolName" followed by JSON
    const contentToolCalls = [];
    
    if (content && typeof content === 'string') {
      console.log("Checking content for improperly formatted tool calls...");
      
      // Expanded regex patterns to catch more variations
      // 1. ## functions.toolName {json}
      // 2. ## toolName {json}
      // 3. [toolName] {json}
      // 4. functions.toolName {json}
      // 5. !function.toolName {json}
      // 6. ```json {json} ``` with toolName nearby
      
      let match;
      // First, try to find !function.toolName pattern (our new preferred format)
      const functionPrefixPattern = /!function\.(\w+)\s*(\{[\s\S]*?\}(?=\s*(?:!function|\n\n|$)))/g;
      
      while ((match = functionPrefixPattern.exec(content)) !== null) {
        const toolName = match[1];
        const jsonStr = match[2];
        
        console.log(`Found potential tool call with !function. format: ${toolName}`);
        
        try {
          const args = JSON.parse(jsonStr);
          contentToolCalls.push({
            id: `content_${toolName}_${Date.now()}`,
            function: {
              name: toolName,
              arguments: jsonStr
            },
            fromContent: true
          });
          console.log(`Successfully parsed ${toolName} from !function. format`);
        } catch (e) {
          console.log(`Failed to parse JSON for ${toolName} from !function. format: ${e.message}`);
        }
      }
      
      // Next try to find [toolName] pattern
      const bracketPattern = /\[([\w]+)\]\s*(\{[\s\S]*?\}(?=\s*(?:\[|\n\n|$)))/g;
      
      while ((match = bracketPattern.exec(content)) !== null) {
        const toolName = match[1];
        const jsonStr = match[2];
        
        console.log(`Found potential tool call with [toolName] format: ${toolName}`);
        
        try {
          const args = JSON.parse(jsonStr);
          contentToolCalls.push({
            id: `content_${toolName}_${Date.now()}`,
            function: {
              name: toolName,
              arguments: jsonStr
            },
            fromContent: true
          });
          console.log(`Successfully parsed ${toolName} from [toolName] format`);
        } catch (e) {
          console.log(`Failed to parse JSON for ${toolName} from [toolName] format: ${e.message}`);
        }
      }
      
      // Next, try the ## functions.toolName pattern (original pattern)
      const hashPattern = /##\s+(?:functions\.)?(\w+)(?:\s*\n|\s+)(\{[\s\S]*?\}(?=\s*(?:##|$)))/g;
      while ((match = hashPattern.exec(content)) !== null) {
        const toolName = match[1];
        const jsonStr = match[2];
        
        console.log(`Found potential tool call with ## functions.toolName format: ${toolName}`);
        
        try {
          const args = JSON.parse(jsonStr);
          contentToolCalls.push({
            id: `content_${toolName}_${Date.now()}`,
            function: {
              name: toolName,
              arguments: jsonStr
            },
            fromContent: true
          });
          console.log(`Successfully parsed ${toolName} from ## functions.toolName format`);
        } catch (e) {
          console.log(`Failed to parse JSON for ${toolName} from ## functions.toolName format: ${e.message}`);
        }
      }
      
      // If we still don't have any tool calls, check if content contains JSON that might be a tool call
      if (contentToolCalls.length === 0 && (content.includes('title') && content.includes('text'))) {
        console.log("Content contains potential postMessage fields, trying to extract...");
        
        try {
          // Find a JSON object in the content
          const jsonMatch = content.match(/(\{[\s\S]*\})/);
          if (jsonMatch && jsonMatch[1]) {
            const jsonStr = jsonMatch[1];
            const args = JSON.parse(jsonStr);
            
            // If it has title and text, it's probably a postMessage
            if (args.title && args.text) {
              contentToolCalls.push({
                id: `content_postMessage_${Date.now()}`,
                function: {
                  name: 'postMessage',
                  arguments: jsonStr
                },
                fromContent: true
              });
              console.log(`Extracted postMessage from unformatted JSON in content`);
            }
          }
        } catch (e) {
          console.log(`Failed to extract JSON from content: ${e.message}`);
        }
      }
    }
    
    // Combine properly formatted tool calls with those found in content
    const allToolCalls = [...toolCalls, ...contentToolCalls];
    console.log(`Total tool calls (proper + content): ${allToolCalls.length}`);
    
    // If there are tools to call, process them
    if (allToolCalls.length > 0) {
      // Look for a finishRequest tool call first, which has priority if present
      const finishRequestCall = allToolCalls.find(call => 
        call.function && call.function.name === 'finishRequest'
      );
      
      // Look for a postMessage tool call
      const postMessageCall = allToolCalls.find(call => 
        call.function && call.function.name === 'postMessage'
      );
      
      // If we have both postMessage and finishRequest, execute postMessage first
      if (postMessageCall) {
        console.log("📣 Found postMessage call - Processing first");
        let toolArgs = {};
        try {
          toolArgs = JSON.parse(postMessageCall.function.arguments);
        } catch (e) {
          console.log(`⚠️ Error parsing postMessage arguments: ${e.message}`);
          // Extract text from content if possible
          if (content && content.includes('text')) {
            const textMatch = content.match(/"text"\s*:\s*"([^"]+)"/);
            if (textMatch && textMatch[1]) {
              toolArgs = {
                title: 'Response',
                text: textMatch[1],
                reasoning: 'Extracted from content'
              };
            } else {
              toolArgs = {
                title: 'Response',
                text: 'I processed your request but encountered a formatting issue.',
                reasoning: 'Error parsing arguments'
              };
            }
          }
        }
        
        // If finishRequest is also present, note it for the next iteration
        if (finishRequestCall) {
          console.log("📢 Found finishRequest call - Will be processed after postMessage");
        }
        
        return {
          toolName: 'postMessage',
          toolArgs,
          toolCallId: postMessageCall.id,
          hasFinishRequest: !!finishRequestCall
        };
      }
      
      // If only finishRequest is present (no postMessage), process it
      if (finishRequestCall) {
        console.log("📢 Found finishRequest call - Processing");
        let toolArgs = {};
        try {
          toolArgs = JSON.parse(finishRequestCall.function.arguments);
        } catch (e) {
          console.log(`⚠️ Error parsing finishRequest arguments: ${e.message}`);
          toolArgs = { reasoning: 'Request complete' }; // Use fallback argument
        }
        
        return {
          toolName: 'finishRequest',
          toolArgs,
          toolCallId: finishRequestCall.id
        };
      }
      
      // Otherwise use the first tool call
      const toolCall = allToolCalls[0];
      const toolName = toolCall.function.name;
      let toolArgs = {};
      
      try {
        toolArgs = JSON.parse(toolCall.function.arguments);
      } catch (e) {
        console.log(`⚠️ Error parsing ${toolName} arguments: ${e.message}`);
        // Provide default arguments based on tool type for resilience
        if (toolName === 'postMessage') {
          toolArgs = {
            title: 'Response',
            text: 'I processed your request, but encountered an issue with the response format.',
            reasoning: 'Error parsing arguments'
          };
        } else {
          toolArgs = {}; // Empty object for other tools
        }
      }
      
      return {
        toolName,
        toolArgs,
        toolCallId: toolCall.id
      };
    }
    
    // If there are no tool calls but there is content, create a postMessage tool call from it
    if (content && content.trim()) {
      console.log("Converting content to postMessage tool call");
      
      // Strip out any tool-like syntax
      const cleanContent = content
        .replace(/##\s+(?:functions\.)?(\w+)(?:\s*\n|\s+)/g, '')
        .replace(/```json\s*|\s*```/g, '')
        .trim();
        
      return {
        toolName: 'postMessage',
        toolArgs: {
          title: 'Response',
          text: cleanContent,
          reasoning: 'Converted from content'
        }
      };
    }
    
    // If there's no content and no tool calls, handle this exceptional case
    if (!content && allToolCalls.length === 0) {
      console.log("⚠️ LLM returned empty response with no tool calls or content");
      throw new Error('LLM returned empty response with no tool calls or content');
    }
    
    // Default error handling if we can't find a valid tool call
    throw new Error('No valid tool call found in LLM response');
  } catch (error) {
    logError('Error parsing tool call from LLM response', error, { llmResponse });
    
    // Return a default error response
    return {
      toolName: 'postMessage',
      toolArgs: {
        title: 'Processing Error',
        text: 'I had trouble understanding how to respond. Could you try a different request?',
        reasoning: 'Error processing response'
      }
    };
  }
}

/**
 * Gets the available tools in the format the LLM expects
 * @returns {Array} - Array of tool definitions
 */
function getAvailableTools() {
  return [
    {
      type: 'function',
      function: {
        name: 'finishRequest',
        description: 'End the conversation flow when the user\'s request is complete',
        parameters: {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              description: 'Optional summary of the conversation or final thoughts'
            },
            reasoning: {
              type: 'string',
              description: 'Explain why you are ending the request (e.g., "Request complete", "Question answered", etc.)'
            }
          },
          required: ['reasoning']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'postMessage',
        description: 'Post a message to Slack',
        parameters: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'The title of the message'
            },
            subtitle: {
              type: 'string',
              description: 'Optional subtitle for the message'
            },
            text: {
              type: 'string',
              description: 'The main text content of the message (supports Slack markdown)'
            },
            color: {
              type: 'string',
              description: 'Color for the message (hex code or named color)'
            },
            fields: {
              type: 'array',
              description: 'Optional fields to display as key-value pairs',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  value: { type: 'string' },
                  short: { type: 'boolean' }
                }
              }
            },
            actions: {
              type: 'array',
              description: 'Optional action buttons',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  value: { type: 'string' },
                  action_id: { type: 'string' }
                }
              }
            },
            thread_ts: {
              type: 'string',
              description: 'Optional thread timestamp to reply in a thread'
            },
            update_ts: {
              type: 'string',
              description: 'Optional timestamp of a message to update instead of posting new'
            },
            reasoning: {
              type: 'string', 
              description: 'Explain briefly why you are sending this specific message'
            }
          },
          required: ['title', 'reasoning']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'getThreadHistory',
        description: 'Retrieve message history from the current thread to rebuild conversation context',
        parameters: {
          type: 'object',
          properties: {
            maxMessages: {
              type: 'integer',
              description: 'Maximum number of messages to retrieve (default: 20, recommended range: 5-50)'
            },
            reasoning: {
              type: 'string',
              description: 'Explain why you need thread history (e.g., "Missing context", "Need to see previous messages")'
            }
          },
          required: ['reasoning']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'exampleTool',
        description: 'An example tool that performs a sample operation',
        parameters: {
          type: 'object',
          properties: {
            input: {
              type: 'string',
              description: 'Input data for the example operation'
            },
            operation: {
              type: 'string',
              description: 'The operation to perform (e.g., analyze, generate, transform)',
              enum: ['analyze', 'generate', 'transform']
            },
            reasoning: {
              type: 'string',
              description: 'Explain why you are using this tool'
            }
          },
          required: ['input', 'operation', 'reasoning']
        }
      }
    }
  ];
}

module.exports = {
  getNextAction
}; 