// Interface for communicating with the LLM
const { LLM_API_KEY, LLM_API_URL, LLM_MODEL } = require('./config.js');
const { logError, formatErrorForLLM } = require('./errors.js');
const fetch = require('node-fetch');
const { getToolsForLLM } = require('./tools');

// Shared constants for message formatting to avoid duplication
const COMMUNICATION_STYLE = `- Be enthusiastic, cheerful, and energetic in your responses! 🎉
- Use emojis frequently to add personality and fun to your messages 😊 💯 ✨
- Be conversational and friendly, showing excitement when helping users
- Use exclamation points to convey enthusiasm where appropriate!
- Express positivity with phrases like "Great question!" or "I'd love to help with that!"
- *Always react to user messages with appropriate emojis using the addReaction tool*
- Use multiple emoji reactions if appropriate - don't limit yourself to just one!
- For positive messages, react with 👍 ❤️ ✨ etc.
- For questions, you can react with 🤔 or 💡
- For fun messages, use 😂 or the custom "kek-doge" emoji
- For processing requests, you can use the custom "loading" emoji
- Include emoji reactions to emphasize important points or show excitement
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
12. WHEN HANDLING ERRORS: Never use hardcoded responses. Always decide what to tell the user based on the error context.`;

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
   * (section:https://example.com/image.jpg:Alt text)Content with image on the right(!section)
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

/**
 * Block Builder syntax for modern Slack formatting
 */
const BLOCK_BUILDER_SYNTAX = `NEW BLOCK BUILDER SYNTAX (Preferred):
You can now use the Block Builder syntax for creating rich Slack messages.
This is the preferred way to format messages:

#blockType: content | param1:value1 | param2:value2

SUPPORTED BLOCK TYPES:
- #header: Title text (⚠️ NOTE: Slack headers don't support rich text. Any <@USER_ID> will be converted to '@Username')
- #section: Standard text content
- #context: Small helper text
- #divider: (no parameters needed)
- #image: https://example.com/image.jpg | altText:Image description
- #contextWithImages: Text content | images:[https://example.com/image1.jpg|Alt text 1, https://example.com/image2.jpg|Alt text 2]
- #userContext: <@U123456> <@U789012> | Optional description text
- #buttons: [Button 1|value1|primary, Button 2|value2|danger, Button 3|value3]
- #fields: [*Field 1 Title*|Field 1 Value, *Field 2 Title*|Field 2 Value]

EXAMPLES:
1. Header with section:
#header: Welcome to our Service!
#section: Here's some important information about your account.

2. Context with images:
#contextWithImages: Here are some example images | images:[https://example.com/image1.jpg|First Image, https://example.com/image2.jpg|Second Image]

3. User context (profiles):
#userContext: <@U123456> <@U789012> | Collaborated on this project
// This shows user profile pictures with names and the description

4. Buttons:
#buttons: [Approve|approve_action|primary, Reject|reject_action|danger, More Info|info_action]

5. Fields:
#fields: [*Status*|Active, *Priority*|High, *Due Date*|Tomorrow]

COMPLEX EXAMPLE:
#header: Monthly Report
#section: Here's your account summary for this month.
#contextWithImages: Account Activity | images:[https://example.com/chart.jpg|Activity Chart]
#divider:
#fields: [*Balance*|$1,250, *Transactions*|43, *Status*|Good Standing]
#section: Would you like to take any actions?
#buttons: [View Details|view_details|primary, Download PDF|download_pdf, Contact Support|contact_support]`;


// Original MESSAGE_FORMATTING_EXAMPLE
const MESSAGE_FORMATTING_EXAMPLE = `{
  "tool": "postMessage",
  "reasoning": "Responding with formatted information",
  "parameters": {
    "text": "#header: Welcome to Your Dashboard\\n\\n#section: Hello <@U123456>, here's some *bold text* and _italic text_ and \`inline code\`.\\n\\n> This is an important quote\\n\\n\\\`\\\`\\\`javascript\\nconst x = 1;\\nconsole.log(x);\\n\\\`\\\`\\\`\\n\\n#context: This additional information appears in smaller text\\n\\n#divider:\\n\\n#userContext: <@U123456> | Your profile information",
    "color": "blue"
  }
}`;

// Create an escaped version of the message formatting example
const ESCAPED_MESSAGE_EXAMPLE = MESSAGE_FORMATTING_EXAMPLE.replace(/\\/g, '\\\\').replace(/`/g, '\\`');

// Create the original TOOL_USAGE_EXAMPLES constant
const TOOL_USAGE_EXAMPLES = `Example 1: First send a message to the user:
\`\`\`json
{
  "tool": "postMessage",
  "reasoning": "Responding to the user's greeting",
  "parameters": {
    "text": "#header: Hello there!\\n\\n#section: Hi <@U123456>, I'm *happy* to help you today. What can I do for you? \\n\\n#header: Available Options\\n\\n* Ask a question\\n* Get information\\n* Request assistance\\n\\n#context: I can help with a variety of topics and questions",
    "color": "blue"
  }
}
\`\`\`

Wait for this tool call to complete before sending another one.

Example 2: After the postMessage completes, send a finishRequest:
\`\`\`json
{
  "tool": "finishRequest",
  "reasoning": "The conversation is complete for this turn",
  "parameters": {
    "summary": "Responded to user's question about Slack APIs"
  }
}
\`\`\``;

// Create an escaped version of TOOL_USAGE_EXAMPLES
const ESCAPED_TOOL_USAGE_EXAMPLES = TOOL_USAGE_EXAMPLES.replace(/\\/g, '\\\\').replace(/`/g, '\\`');

const MESSAGE_FORMATTING_GUIDELINES = `You have two ways to format messages:

1. BASIC FORMATTING:
Create simple messages using these parameters:
- text: Your main message content with formatting options
- color: Message accent color (blue, green, red, orange, purple or hex code)

2. USING BLOCK BUILDER FORMATTING:
We use a modern block builder approach combined with standard Markdown:

${BLOCK_BUILDER_GUIDE}

USER MENTIONS FORMATTING:
- For direct user mentions in text: <@USERID> (e.g., "Hello <@U123456>")
- For user context blocks: #userContext: <@U123456> | optional description
- ⚠️ NOTE: In #header blocks, user mentions like <@USER_ID> will be automatically converted to plain text "@Username" format
- For clickable user mentions, use #section, #context, and #userContext blocks where mrkdwn formatting is supported
- NEVER use plain @UserID format as it won't be properly formatted in Slack

HYPERLINK FORMATTING:
- Always use Slack format for links: <URL|text label>
- Example: <https://slack.com|Click here>
- NEVER use Markdown format [text](URL) for regular links
- For images, see IMAGE DISPLAY OPTIONS below

IMAGE DISPLAY OPTIONS (THREE METHODS):
1. Standalone Image Block - Choose ONE of these methods:
   * Markdown image syntax: ![Alt text](https://example.com/image.jpg)
   * BBCode format: (image:https://example.com/image.jpg:Alt text)
   This displays a full-width image in the message.

2. Section with Image Accessory:
   * (section:https://example.com/image.jpg:Alt text)Content with image accessory(!section)
   This shows text content with a smaller image thumbnail on the right side.

3. Image Hyperlink:
   * <https://example.com/image.jpg|View image>
   This shows just a clickable link but doesn't embed the image.

USER CONTEXT BLOCK EXAMPLES:
- When asked to use "user context formatting", use this block builder syntax:
  #userContext: <@U123456>
- For multiple users:
  #userContext: <@U123456> <@U789012>
- With descriptive text:
  #userContext: <@U123456> | completed the task
- This creates a special block that highlights the user, different from a simple mention.

EXAMPLE:
\`\`\`
${ESCAPED_MESSAGE_EXAMPLE}
\`\`\`

IMPORTANT: Do NOT attempt to specify Slack blocks directly. Use only the formatting methods above.`;

/**
 * User Context Block Format guidelines
 */
const USER_CONTEXT_BLOCK_FORMAT = `USER CONTEXT BLOCK FORMAT:
When asked to use "user context formatting" or "user context blocks", use this block builder syntax:
#userContext: <@USER_ID>

You can also add descriptive text by using a pipe character:
#userContext: <@USER_ID> | did something cool

For multiple users: 
#userContext: <@U123456> <@U234567> | collaborated on a task

This format will display user profile pictures with names and optional descriptive text:
- For single users: Shows user avatar with their name and description
- For 2-3 users: Shows all avatars with their names and description 
- For 4+ users: Shows first two avatars with "and X others" text

Always format user IDs with <@USER_ID> syntax - this is the LLM's responsibility.`;

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
      if (context.originalText) {
        console.log(`Original (unfiltered) query: "${context.originalText}"`);
      }
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
 * Generates the system message for the LLM
 * @param {Object} context - Context information for the conversation
 * @returns {string} - Formatted system message
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
  
  // Get current date and time in Brazil
  const brazilTime = getBrazilDateTime();
  
  return `Hi there! You're Aya, an enthusiastic and helpful AI assistant in Slack! 🎉 This is a conversation between you and users.

IMPORTANT CONTEXT:
You're in a ${ctx.isDirectMessage ? 'direct message' : 'thread'} in Slack.
- User ID: ${ctx.userId || 'unknown'}
- Channel: ${ctx.channelId || 'unknown'}
- ${ctx.threadTs ? `Thread: ${ctx.threadTs}` : ''}
- Current Date/Time in Brazil: ${brazilTime}

⚠️ CUSTOM EMOJI REACTIONS AVAILABLE:
You can react to messages with emojis using the addReaction tool!
- Standard emojis: 👍 ❤️ 😂 🎉 🤔 👀 etc.
- Custom workspace emojis: 
  - "loading" - Use while processing long requests
  - "kek-doge" - Use for funny/humorous messages
- Always react to user messages with at least one appropriate emoji
- You can add multiple emoji reactions to show different sentiments
- Example usage: 
  \`\`\`json
  {
    "tool": "addReaction",
    "reasoning": "Adding a thumbs up reaction to show agreement",
    "parameters": {
      "emoji": "thumbsup"
    }
  }
  \`\`\`

⚠️ USER MENTION FORMAT: Always use <@USER_ID> format for user mentions (e.g., <@U123456>)
   The LLM is fully responsible for proper user mention formatting.
   NEVER use @USER_ID or plain USER_ID or <@|USER_ID> formats, as they WON'T work in Slack.
   Do not rely on backend formatting - YOU must format all user mentions correctly.

⚠️ USER CONTEXT BLOCK FORMAT:
   When asked to use "user context formatting" or "user context blocks", use this block builder syntax:
   #userContext: <@${ctx.userId || 'USER_ID'}>
   Example: #userContext: <@${ctx.userId || 'U123456'}>
   
   You can also add descriptive text by using a pipe character:
   #userContext: <@${ctx.userId || 'USER_ID'}> | did something cool
   For multiple users: #userContext: <@U123456> <@U234567> | collaborated on a task
   
   This format will display user profile pictures with names and optional descriptive text:
   - For single users: Shows user avatar with their name and description
   - For 2-3 users: Shows all avatars with their names and description 
   - For 4+ users: Shows first two avatars with "and X others" text
   
   Always format user IDs with <@USER_ID> syntax - this is the LLM's responsibility.

   ⚠️ IMPORTANT LIMITATION: Never use user mentions in #header blocks as they are not supported by Slack.
   Only use mentions in #section, #context, and #userContext blocks.

   ⚠️ NOTE ABOUT HEADERS: User mentions in #header blocks will be displayed as plain text "@Username" 
   (the actual user mention feature won't work). For clickable user mentions, 
   use #section, #context, and #userContext blocks.

Company Information:
${COMPANY_INFO}

COMMUNICATION STYLE:
${COMMUNICATION_STYLE}

CRITICAL INSTRUCTIONS:
${CRITICAL_BEHAVIOR}

YOUR TOOLS:
${toolsList}

RICH FORMATTING CAPABILITIES:
${BLOCK_BUILDER_SYNTAX}

EXAMPLE OF MESSAGE WITH BLOCK BUILDER:
\`\`\`json
{
  "tool": "postMessage",
  "reasoning": "Responding to user's question about their account",
  "parameters": {
    "text": "#header: Your Account Information\\n\\n#section: Here's the information you requested about your account.\\n\\n#contextWithImages: Recent Activities | images:[https://example.com/chart.jpg|Activity Chart]\\n\\n#divider:\\n\\n#fields: [*Balance*|$1,250, *Transactions*|43, *Status*|Good Standing]\\n\\n#buttons: [View Details|view_details|primary, Download Report|download_report]",
    "color": "blue"
  }
}
\`\`\`

You can still use basic Markdown for simple formatting:
- *bold* for bold text
- _italic_ for italic text
- \`code\` for inline code
- \`\`\`language\\ncode\\n\`\`\` for code blocks
- > text for blockquotes
- * or - for bullet lists
- 1. 2. 3. for numbered lists

TOOL CALL FORMAT:
Use this exact JSON format for EACH tool call (send only one at a time):
${TOOL_CALL_FORMAT}

IMPORTANT: ALWAYS include a "tool" field, a "reasoning" field, and a "parameters" object. The reasoning field should ALWAYS be at the top level, not inside parameters.

PARAMETER STRUCTURE REQUIREMENTS:
${PARAMETER_STRUCTURE_EXAMPLES}

DO NOT use any other format for tool calls. ONLY use the format shown above.

EXAMPLES OF CORRECT TOOL USAGE SEQUENCE:

${ESCAPED_TOOL_USAGE_EXAMPLES}

⚠️ REMEMBER (CRITICAL): 
${REMEMBER_CRITICAL}`;
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
  const systemMessage = getSystemMessage(context || {});
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
      // Process all messages, including those with dev prefix
      // (The dev prefix should already be stripped at this point)
      
      // Check if this is the current user's message (matches the context)
      if (context && message.isUser && message.text === context.text) {
        currentMessageFound = true;
      }
      
      // Only add prefixes for non-system messages
      if (!message.isSystemNote) {
        // Determine if message is from the bot or a user
        if (message.isUser) {
          if (message.isButtonClick) {
            // Format button clicks distinctively
            messages.push({
              role: 'user',
              content: `USER SELECTED: ${message.text}`
            });
          } else {
            // Simple format for user messages - no redundant prefixes
            messages.push({
              role: 'user',
              content: message.text || 'No text content'
            });
          }
        } else {
          // For bot messages, format with clear indication this was already sent
          prevBotMessageCount++;
          
          let sentMessage = '';
          if (message.title) {
            sentMessage += `Title: "${message.title}"\n`;
          }
          
          // Use the description field if available (for messages with attachments/formatting)
          if (message.description) {
            sentMessage += message.description;
          } else {
            sentMessage += `Content: "${message.text || 'No text content'}"`;
          }
          
          messages.push({
            role: 'assistant',
            content: `PREVIOUSLY SENT: ${sentMessage}`
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
      }
    }
  }

  // Add the current user message if not already found in message history
  // IMPORTANT: Only add it if it wasn't already found in thread history
  if (context && context.text && !currentMessageFound) {
    console.log("Adding current message to context (wasn't found in message history)");
    
    // Check one more time through a text comparison - sometimes the object equality check might fail
    // This fixes cases where the message was added to thread state but using different objects
    const isDuplicate = threadState.messages && threadState.messages.some(msg => 
      msg.isUser && msg.text === context.text
    );
    
    if (!isDuplicate) {
      messages.push({
        role: 'user',
        content: context.text || 'No text content'
      });
    } else {
      console.log("Found duplicate message during secondary check - not adding again");
    }
  } else {
    console.log("Current user message already included in thread history, not adding again");
  }

  // Handle button clicks specially
  if (context && context.actionId) {
    // Add a clear notice about button clicks
    messages.push({
      role: 'system',
      content: `The user clicked a button with action ID "${context.actionId}" and value "${context.actionValue}". Respond to this button click directly.`
    });
  }

  // Add a single reminder if we've already posted messages - no need for multiple warnings
  if (prevBotMessageCount > 0) {
    messages.push({
      role: 'system',
      content: `You have already sent ${prevBotMessageCount} message(s) in this conversation. Do not send duplicate messages.`
    });
  }
  
  // Add previous tool executions to context (limited)
  // Use the getToolExecutionHistory method if available
  if (typeof threadState.getToolExecutionHistory === 'function') {
    const toolExecutionHistory = threadState.getToolExecutionHistory(3); // Just get last 3
    
    if (toolExecutionHistory.length > 0) {
      console.log(`Adding ${toolExecutionHistory.length} recent tool executions to context`);
      
      // Add all tool call results to the context
      for (const execution of toolExecutionHistory) {
        // Include all tool results, especially getUserAvatar
        // Don't skip any tools like we used to, because the LLM needs to see all results
        
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
        
        console.log(`Added ${execution.toolName} result to LLM context`);
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
      formattedResponse = {
        thread_history_retrieved: true,
        reasoning: reasoning,
        messages_count: response?.messagesRetrieved || 0,
        has_parent: response?.threadStats?.parentMessageRetrieved || false
      };
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
          
          // Sanitize control characters that can break JSON parsing
          cleanedArgs = cleanedArgs.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '');
          
          // Fix common JSON syntax issues
          cleanedArgs = cleanedArgs
            .replace(/,\s*}/g, '}')                // Remove trailing commas in objects
            .replace(/,\s*\]/g, ']')               // Remove trailing commas in arrays
            .replace(/\\'/g, "'")                  // Replace escaped single quotes
            .replace(/\\"/g, '"')                  // Fix double escaped quotes
            .replace(/\\\\/g, '\\')                // Fix double backslashes
            .replace(/([^\\])\\n/g, '$1\\\\n');    // Fix incorrectly escaped newlines
          
          // Check for duplicate parameters sections which cause parsing errors
          if (cleanedArgs.match(/"parameters"\s*:\s*{[^{}]*"parameters"\s*:/)) {
            console.log("Detected duplicate nested parameters structure - attempting to fix");
            
            try {
              // More robust approach - try to extract the inner parameters object completely
              const outerMatch = cleanedArgs.match(/"parameters"\s*:\s*({[^]*})\s*(?:,|\})/);
              if (outerMatch) {
                const parametersContent = outerMatch[1];
                // Now find the inner parameters object
                const innerMatch = parametersContent.match(/"parameters"\s*:\s*({[^]*?})\s*(?:,|$)/);
                
                if (innerMatch) {
                  // Replace the original structure with flattened parameters
                  const flattenedContent = parametersContent.replace(/"parameters"\s*:\s*{[^]*?}\s*(?:,|$)/, '');
                  
                  // Now merge the inner parameters content
                  const innerContent = innerMatch[1];
                  
                  // Create a merged parameters object that combines both levels
                  const mergedParameters = `"parameters": ${flattenedContent.replace(/}$/, `, ${innerContent.replace(/^{/, '').replace(/,$/, '')}`)}`;
                  
                  // Replace the original parameters with our merged version
                  cleanedArgs = cleanedArgs.replace(/"parameters"\s*:\s*{[^]*?}\s*(?:,|\})/, mergedParameters);
                  
                  console.log("Successfully flattened nested parameters structure");
                } else {
                  // Fallback to simpler approach
                  cleanedArgs = cleanedArgs.replace(/"parameters"\s*:\s*{([^{]*)"parameters"\s*:/, (match, prefix) => {
                    return `"parameters": {${prefix}"innerParams":`;
                  });
                }
              } else {
                // Fallback to simpler approach
                cleanedArgs = cleanedArgs.replace(/"parameters"\s*:\s*{([^{]*)"parameters"\s*:/, (match, prefix) => {
                  return `"parameters": {${prefix}"innerParams":`;
                });
              }
            } catch (structureError) {
              console.log(`Error during structure fix: ${structureError.message}`);
              // Fallback to simpler approach
              cleanedArgs = cleanedArgs.replace(/"parameters"\s*:\s*{([^{]*)"parameters"\s*:/, (match, prefix) => {
                return `"parameters": {${prefix}"innerParams":`;
              });
            }
          }
          
          // Similar fix for duplicate reasoning fields
          if (cleanedArgs.match(/"parameters"\s*:\s*{[^{}]*"reasoning"\s*:/)) {
            console.log("Detected duplicate reasoning fields - removing from nested parameters");
            
            // This approach preserves only the top-level reasoning if it exists
            cleanedArgs = cleanedArgs.replace(/"parameters"\s*:\s*{([^{]*)"reasoning"\s*:\s*"([^"]+)"/, (match, prefix, reasoningValue) => {
              return `"parameters": {${prefix}`;
            });
            
            console.log("Removed duplicate reasoning from parameters object");
          }
          
          // Special handling for parentheses format in text strings
          // This regex looks for patterns like (header)text(!header) within JSON string values
          // and ensures the parentheses are properly escaped
          cleanedArgs = cleanedArgs.replace(/"(text|content)"\s*:\s*"(.*?)"/g, (match, propName, textValue) => {
            // Replace unescaped parentheses in the text value with escaped ones
            let escapedText = textValue
              .replace(/\\\(/g, '{{ESCAPED_LEFT_PAREN}}') // Save already escaped parentheses
              .replace(/\\\)/g, '{{ESCAPED_RIGHT_PAREN}}')
              .replace(/\(/g, '\\(')  // Escape unescaped left parentheses
              .replace(/\)/g, '\\)')  // Escape unescaped right parentheses
              .replace(/{{ESCAPED_LEFT_PAREN}}/g, '\\(')  // Restore with proper escaping
              .replace(/{{ESCAPED_RIGHT_PAREN}}/g, '\\)');
            
            return `"${propName}":"${escapedText}"`;
          });
          
          // Leave text and content properties unchanged - no parentheses escaping needed
          // with block builder syntax
          
          /* REMOVED PARENTHESES ESCAPING:
          cleanedArgs = cleanedArgs.replace(/"(text|content)"\s*:\s*"(.*?)"/g, (match, propName, textValue) => {
            // Replace unescaped parentheses in the text value with escaped ones
            let escapedText = textValue
              .replace(/\\\(/g, '{{ESCAPED_LEFT_PAREN}}') // Save already escaped parentheses
              .replace(/\\\)/g, '{{ESCAPED_RIGHT_PAREN}}')
              .replace(/\(/g, '\\(')  // Escape unescaped left parentheses
              .replace(/\)/g, '\\)')  // Escape unescaped right parentheses
              .replace(/{{ESCAPED_LEFT_PAREN}}/g, '\\(')  // Restore with proper escaping
              .replace(/{{ESCAPED_RIGHT_PAREN}}/g, '\\)');
            
            return `"${propName}":"${escapedText}"`;
          });
          */
          
          // No special parentheses handling needed - block builder syntax doesn't use parentheses
          
          // Add quotes to unquoted property names as the final step
          cleanedArgs = cleanedArgs.replace(/([a-zA-Z0-9_$]+):/g, '"$1":');
          
          console.log("Sanitized JSON arguments, attempting to parse...");
          
          // Log the sanitized JSON for debugging
          if (process.env.DEBUG_JSON === 'true') {
            console.log("Sanitized JSON:", cleanedArgs);
          }
          
          // Parse the cleaned JSON
          parameters = JSON.parse(cleanedArgs);
          console.log("Successfully parsed tool parameters");
        } catch (error) {
          console.log(`Error parsing tool parameters: ${error.message}`);
          console.log("Failed JSON:", toolCall.function.arguments.substring(0, 200) + "...");
          
          // Log more details about the error position
          if (error instanceof SyntaxError && error.message.includes('position')) {
            try {
              // Extract position from error message
              const posMatch = error.message.match(/position (\d+)/);
              if (posMatch && posMatch[1]) {
                const errorPos = parseInt(posMatch[1]);
                const startPos = Math.max(0, errorPos - 50);
                const endPos = Math.min(toolCall.function.arguments.length, errorPos + 50);
                const errorContext = toolCall.function.arguments.substring(startPos, endPos);
                
                console.log(`JSON error near position ${errorPos}:`);
                console.log("Error context:", errorContext);
                console.log("Error location:", "^".padStart(Math.min(50, errorPos - startPos) + 1));
              }
            } catch (contextError) {
              console.log("Could not extract error context:", contextError.message);
            }
          }
          
          // Try again with a more aggressive approach for serious JSON errors
          try {
            console.log("Attempting more aggressive JSON repair...");
            // Create a minimal valid JSON with just the text field
            const textMatch = toolCall.function.arguments.match(/"text"\s*:\s*"(.*?)(?<!\\)"/);
            if (textMatch && textMatch[1]) {
              // Extract just the text content and create a simple valid JSON
              parameters = { 
                text: textMatch[1],
                reasoning: "Recovered from JSON parsing error"
              };
              console.log("Recovered text content from damaged JSON");
            } else {
              // Fallback when we can't even extract the text
              parameters = { 
                text: "I couldn't process that correctly. Please try again with a simpler request.", 
                reasoning: "Parameter parsing failed" 
              };
            }
          } catch (secondError) {
            // Ultimate fallback for catastrophic parsing failures
            parameters = { 
              text: "I couldn't process that correctly. Please try again with a simpler request.", 
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
          parameters,
          reasoning: parameters.reasoning
        });
      }
      
      console.log(`Successfully extracted ${toolCalls.length} tool calls from native format`);
      
      // Final standardization: For each tool call, ensure reasoning is at the top level
      for (const toolCall of toolCalls) {
        // If there's no top-level reasoning but there is parameters.reasoning, move it to top level
        if (!toolCall.reasoning && toolCall.parameters?.reasoning) {
          toolCall.reasoning = toolCall.parameters.reasoning;
          delete toolCall.parameters.reasoning;
          console.log('Moved reasoning from parameters to top level');
        }
        
        // If there's no reasoning at all, add a default
        if (!toolCall.reasoning) {
          toolCall.reasoning = "Auto-generated reasoning for tool call";
          console.log('Added default reasoning at top level');
        }
      }
      
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
            },
            reasoning: "Converting regular message to tool call"
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
      // Skip the reasoning parameter as it's now at the top level
      if (paramName === 'reasoning') return;
      
      // Convert description to string and check if optional
      const descStr = typeof description === 'string' ? description : String(description);
      
      // If description doesn't contain "optional", add to required
      if (!descStr.toLowerCase().includes('optional')) {
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
          paramName === 'columns' ||
          paramName === 'timeline' ||
          paramName === 'accordion' ||
          (descStr.toLowerCase().includes('array'))) {
        paramType = 'array';
      }
      // Check if parameter is likely an object based on name or description
      else if (paramName === 'metadata' || 
               paramName === 'context' || 
               paramName === 'config' ||
               paramName === 'table' ||
               paramName === 'richHeader' ||
               (descStr.toLowerCase().includes('object'))) {
        paramType = 'object';
      }
      
      // Create the parameter definition with appropriate type
      if (paramType === 'array') {
        properties[paramName] = {
          type: 'array',
          description: descStr,
          items: {
            type: 'object'
          }
        };
      } else if (paramType === 'object') {
        properties[paramName] = {
          type: 'object',
          description: descStr
        };
      } else {
        properties[paramName] = {
          type: 'string',
          description: descStr
        };
      }
    });
    
    // Create the top level function definition with required parameters
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties,
          required
        }
      }
    };
  });
}

module.exports = {
  getNextAction,
  processJsonStringParameters,
  formatToolResponse,
  getBrazilDateTime,
  
  // Export constants for potential reuse in other modules
  constants: {
    COMMUNICATION_STYLE,
    CRITICAL_BEHAVIOR,
    TOOL_CALL_FORMAT,
    COMPANY_INFO,
    FORMAT_REQUIREMENTS,
    REMEMBER_CRITICAL,
    MESSAGE_FORMATTING_EXAMPLE,
    ESCAPED_MESSAGE_EXAMPLE,
    TOOL_USAGE_EXAMPLES,
    ESCAPED_TOOL_USAGE_EXAMPLES,
    PARAMETER_STRUCTURE_EXAMPLES,
    BLOCK_BUILDER_GUIDE,
    BLOCK_BUILDER_SYNTAX,
    MESSAGE_FORMATTING_GUIDELINES,
    USER_CONTEXT_BLOCK_FORMAT
  }
};
