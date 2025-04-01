// Interface for communicating with the LLM
const { LLM_API_KEY, LLM_API_URL, LLM_MODEL } = require('./config.js');
const { logError, formatErrorForLLM } = require('./errors.js');
const fetch = require('node-fetch');
const { getToolsForLLM } = require('./tools');

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
14. BUTTON CREATION (CRITICAL): You MUST use the tool 'postMessage' (NOT 'createButtonMessage') with #buttons:[Label|value|style, ...] syntax INSIDE the text parameter. Example: "#header: Title\\n\\n#section: Text\\n\\n#buttons:[Option 1|value1, Option 2|value2]"
15. AVOID DUPLICATE MESSAGES: If your message failed to create buttons, don't send a nearly identical message - instead, make the content substantially different.
16. USE CORRECT TOOL FOR BUTTONS: Always use postMessage with #buttons syntax, NOT the separate createButtonMessage tool.
17. BUTTON SELECTIONS (CRITICAL): When a user clicks a button, the message is AUTOMATICALLY updated to show their selection. DO NOT try to update it again with updateMessage or updateButtonMessage. Instead, send a NEW message acknowledging their choice and providing next steps.`;

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

### Button Formatting (IMPORTANT):
When creating interactive buttons, ALWAYS define explicit button labels using one of these formats:

1. BlockBuilder format (preferred):
\`\`\`
#header: Choose an Option
#section: Select the option you prefer
#buttons: [First Option|option1|primary, Second Option|option2, Third Option|option3]
\`\`\`

2. Direct parameter format:
\`\`\`
{
  "tool": "createButtonMessage",
  "reasoning": "Creating interactive buttons",
  "parameters": {
    "text": "Choose an option",
    "buttons": ["First Option", "Second Option", "Third Option"]
  }
}
\`\`\`

3. Structured button objects:
\`\`\`
{
  "tool": "createButtonMessage",
  "reasoning": "Creating interactive buttons",
  "parameters": {
    "text": "Choose an option",
    "buttons": [
      { "text": "First Option", "value": "option1", "style": "primary" },
      { "text": "Second Option", "value": "option2" },
      { "text": "Third Option", "value": "option3" }
    ]
  }
}
\`\`\`

NEVER rely on default button labels ("Option 1", "Option 2"). Always explicitly define them.

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
- #header: Large title text
- #section: Standard message content with markdown
- #context: Smaller helper text
- #divider: Horizontal separator line
- #image: URL | altText:Image description
- #contextWithImages: Text | images:[URL1|alt1, URL2|alt2]
- #buttons: Define interactive action buttons or link buttons. See format below.
- #fields: [*Title 1*|Value 1, *Title 2*|Value 2]

BUTTONS SYNTAX (#buttons):
The format is #buttons:[Label|ValueOrURL|Style, ...] where:

1.  **Action Buttons:** Trigger bot actions.
    -   Format: \`Label|action_value|style\` (style is optional)
    -   Styles: primary (green), danger (red), default (grey)
    -   *Example:* \`#buttons:[Approve|approve_task|primary, Reject|reject_task|danger, More Info|info_needed]\`

2.  **Link Buttons:** Open a URL in the user's browser.
    -   Format: \`Label|https://example.com\`
    -   *Example:* \`#buttons:[Visit Google|https://google.com, Open Docs|https://docs.example.com]\`

-   You can mix action and link buttons in the same #buttons definition.
-   *Example:* \`#buttons:[Confirm Order|confirm_order|primary, View Details|https://orders.example.com/123]\`

⚠️ IMPORTANT: When creating action buttons, ALWAYS specify custom button labels and meaningful action values. Never rely on default "Option 1" labels.

EXAMPLE OF COMPLETE MESSAGE WITH BUTTONS:
\`\`\`
{
  "tool": "postMessage",
  "reasoning": "Creating a message with buttons",
  "parameters": {
    "text": "#header: Choose an Option\\n\\n#section: Please select from the following options:\\n\\n#buttons:[Pizza|food_pizza|primary, Salad|food_salad, Sandwich|lunch_sandwich]"
  }
}
\`\`\`

EXAMPLES OF BASIC BLOCKS:
1. Header and Section:
#header: Project Status Report
#section: The project is *on track* and progressing well.

2. Context (smaller text):
#context: Last updated: 2 hours ago

3. Image:
#image: https://example.com/image.jpg | altText:Project timeline visualization

4. Buttons (Action and Link):
#buttons: [Approve|approve_action|primary, Reject|reject_action|danger, Documentation|https://docs.example.com]

5. Fields:
#fields: [*Project*|Website Redesign, *Deadline*|March 15, *Status*|On Track]`;

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

const MESSAGE_FORMATTING_GUIDELINES = `We use a modern block builder approach combined with standard Markdown. This is the REQUIRED way to create buttons using the #buttons syntax.

BASIC MARKDOWN (supported in most blocks):
- *bold* for bold text
- _italic_ for italic text
- ~strikethrough~ for strikethrough
- \`code\` for inline code
- \`\`\`code block\`\`\` for multi-line code
- > quote for blockquotes
- * or - for bullet lists
- 1. for numbered lists
- <https://example.com|Link text> for links (Slack format)

BLOCK TYPES AND SYNTAX:
1. #header: Large title text
2. #section: Standard message content with markdown
3. #context: Smaller helper text
4. #divider: (no content needed)
5. #image: URL | altText:Image description
6. #buttons: [Label|value|style, Label2|value2, Label3|value3]
7. #fields: [*Field title*|value, *Field2*|value2]

BUTTON CREATION RULES:
1. ALWAYS use the #buttons: syntax INSIDE a postMessage tool call
2. NEVER use the createButtonMessage tool directly
3. Format: #buttons:[Label|value|style, ...] where style is optional
4. For link buttons, use URL as value: #buttons:[Visit Site|https://example.com]

EXAMPLE FOR CREATING BUTTONS:
\`\`\`
{
  "tool": "postMessage",
  "reasoning": "Showing options with buttons",
  "parameters": {
    "text": "#header: Lunch Options\\n\\n#section: What would you like for lunch?\\n\\n#buttons:[Pizza|lunch_pizza|primary, Salad|lunch_salad, Sandwich|lunch_sandwich]"
  }
}
\`\`\`

IMPORTANT: Do NOT attempt to specify Slack blocks directly. Use only the formatting methods above. The #buttons syntax is the ONLY way to create buttons.`;

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
 * Preprocess JSON string to handle literal newlines and common formatting issues
 * before standard JSON.parse
 * @param {string} jsonString - Raw JSON string from LLM
 * @returns {string} - Normalized JSON string ready for parsing
 */
function preprocessLlmJson(jsonString) {
  if (!jsonString) return jsonString;
  
  console.log("Preprocessing LLM JSON response");
  
  try {
    let processedJson = jsonString;
    
    // A safer approach that focuses on fixing common issues without over-processing
    
    // 1. Fix trailing commas (common OpenAI LLM error)
    processedJson = processedJson
      .replace(/,\s*}/g, '}')    // Remove trailing commas in objects
      .replace(/,\s*\]/g, ']');  // Remove trailing commas in arrays
    
    // 2. Fix unquoted property names (another common error)
    // Only apply to clear cases of unquoted property names at the start of a line or after a comma/bracket
    processedJson = processedJson.replace(
      /([\{\,]\s*)([a-zA-Z0-9_]+)(\s*:)/g, 
      '$1"$2"$3'
    );
    
    // 3. Remove literal tab characters that can break JSON
    processedJson = processedJson.replace(/\t/g, ' ');
    
    // 4. Handle newlines in string values - this is tricky but don't overdo it
    // Only apply to actual literal newlines inside quoted strings
    // Match quoted strings and handle them individually
    let inString = false;
    let result = '';
    
    // Simple character-by-character parser to handle newlines in strings
    for (let i = 0; i < processedJson.length; i++) {
      const char = processedJson[i];
      const nextChar = processedJson[i + 1] || '';
      
      // Handle string boundaries
      if (char === '"' && (i === 0 || processedJson[i - 1] !== '\\')) {
        inString = !inString;
        result += char;
      }
      // Handle newlines inside strings only
      else if (inString && (char === '\n' || char === '\r')) {
        result += '\\n'; // Replace with escaped newline
        if (char === '\r' && nextChar === '\n') i++; // Skip the \n in \r\n
      }
      // Everything else is unchanged
      else {
        result += char;
      }
    }
    
    // If we got stuck in a string parsing state, the JSON is malformed
    // Better to return the original than a partially processed version
    if (inString) {
      console.log("⚠️ Warning: Malformed JSON with unclosed strings detected");
      return jsonString;
    }
    
    // Log the changes for debugging
    if (result !== jsonString) {
      console.log("Successfully preprocessed JSON with fixes");
      return result;
    } else {
      console.log("No JSON issues detected during preprocessing");
      return jsonString;
    }
  } catch (error) {
    console.log(`Error in JSON preprocessing: ${error.message}`);
    return jsonString; // Return original if preprocessing fails
  }
}

/**
 * Adds button click information to LLM context
 * @param {Array} messages - Messages array being sent to LLM
 * @param {Object} threadState - Thread state
 * @returns {Array} - Updated messages array
 */
function addButtonClickInfoToContext(messages, threadState) {
  // Check if we have button selection info
  if (threadState.lastButtonSelection) {
    const selection = threadState.lastButtonSelection;
    
    // Check if the button selection has already been visually acknowledged
    let contextMessage;
    if (threadState.buttonSelectionAlreadyAcknowledged) {
      // STRONGER language when the button has already been visually updated
      contextMessage = `⚠️ BUTTON SELECTION: The user clicked the "${selection.text}" button with value "${selection.value}". 
The message UI has ALREADY been updated to show "✅ Opção selecionada: ${selection.text}".
DO NOT send another message just to acknowledge this selection - it would be redundant and confusing.
Instead, directly provide the next logical step related to their "${selection.value}" choice.`;
      console.log('Added consolidated button selection context with STRONG warning about UI updates');
    } else {
      // Standard language for normal cases
      contextMessage = `⚠️ BUTTON SELECTION: The user clicked the "${selection.text}" button with value "${selection.value}". 
The message with buttons has already been updated automatically to show this selection.
Please respond with a NEW message acknowledging their choice. DO NOT attempt to update the original message again.`;
      console.log('Added consolidated button selection context for LLM');
    }
    
    // Add a single consolidated system message right after the initial system message
    messages.splice(1, 0, {
      role: 'system',
      content: contextMessage
    });
  }
  
  return messages;
}

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
        
        // Get recent messages
        const messages = formatMessagesForLLM(threadState);
        
        // Log the content being sent to the LLM
        let userQuery = context?.text || 'No user query found in context!';
        console.log('\n--- Content being sent to LLM ---');
        console.log(userQuery);
        console.log(`Sending ${messages.length} messages to LLM`);
        
        // Detailed context logging
        logDetailedContext(threadState, messages);
        
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
        return await sendRequestToLLM(requestBody, threadState);
    } catch (error) {
        console.log(`\n❌ LLM ERROR ❌`);
        console.log(error.message);
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

⚠️ EMOJI USAGE:
- Use emojis freely in your text responses 😊 👍 🚀
- React to messages with emoji reactions using the addReaction tool
- You can add multiple emoji reactions by passing an array to the emoji parameter
- Feel free to use custom workspace emojis in both reactions and text messages

Standard emojis:
- 👍 ❤️ 😂 🎉 🤔 👀 etc.
- thumbsup, thumbsdown, heart, smile, x
- thinking_face (can use "thinking" as alias)
- white_check_mark (can use "check" as alias)

Workspace custom emojis by category:

Reactions:
- eyesshaking - Eyes shaking/vibrating with surprise
- thonking - Enhanced thinking face meme
- catyes/catno - Cat nodding or shaking head
- ddrup - DDR-style up arrow
- alert - Warning/caution symbol
- loading - Loading animation for processing requests

Fun/Meme emojis:
- kek-doge (can use "kekdoge" as alias) - Funny doge meme
- kekw - Laughing Pepe face
- blob-wave - Cute blob character waving
- chefskiss - Chef's kiss gesture
- this-is-fine-fire - "This is fine" dog surrounded by flames

Pepe & Peepo emojis:
- pepebigbrain, pepechrist, pepeglass, pepelaugh, pepelove, peperofl, pepe-sad-emo
- peepocheer, peepoclap, peepohey, peeporun, peeposhy, prayge
- wicked-thumbs-up - Stylized thumbs up

CloudWalk/Company-specific:
- brlc - InfinitePay logo
- cw-dark - CloudWalk logo

Example reaction with a single emoji: 
\`\`\`json
{
  "tool": "addReaction",
  "reasoning": "Adding reaction to user's message",
  "parameters": {
    "emoji": "kek-doge"
  }
}
\`\`\`

Example with multiple emoji reactions:
\`\`\`json
{
  "tool": "addReaction",
  "reasoning": "Adding multiple reactions to show enthusiasm",
  "parameters": {
    "emoji": ["heart", "pepebigbrain", "this-is-fine-fire"]
  }
}
\`\`\`

⚠️ USER MENTION FORMAT: Always use <@USER_ID> format for user mentions (e.g., <@U123456>)
   You're fully responsible for proper user mention formatting.
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
  // Create messages array
  let messages = [];
  
  // Add system message first
  const context = threadState.getMetadata ? threadState.getMetadata('context') : {};
  messages.push({
    role: 'system',
    content: getSystemMessage(context)
  });
  
  // Add any explicit button selection context if available
  if (threadState.lastButtonSelection && threadState.buttonSelectionAlreadyAcknowledged) {
    // Add a special system message that warns about the button being acknowledged already
    messages.push({
      role: 'system',
      content: `⚠️ BUTTON SELECTION: The user clicked the "${threadState.lastButtonSelection.text}" button with value "${threadState.lastButtonSelection.value}".
The message with buttons has ALREADY been updated in the UI to show "✅ Opção selecionada: ${threadState.lastButtonSelection.text}".
DO NOT post another message just to acknowledge this selection - it's redundant.
Instead, directly provide the next logical step related to their "${threadState.lastButtonSelection.value}" choice.`
    });
    
    console.log("Added consolidated button selection context for LLM");
  }
  
  // Get all user and bot messages from thread state
  let hasButtonClick = false;
  if (threadState.messages && threadState.messages.length > 0) {
    // Get last 10 messages max (to avoid overly large context)
    const recentMessages = threadState.messages.slice(-10);
    
    // Check if there's a button click in the recent messages
    hasButtonClick = recentMessages.some(msg => msg.isButtonClick);
    
    // For each message in the thread 
    for (const message of recentMessages) {
      // Skip system notes about button clicks - we'll add a consolidated message later
      if (message.isSystemNote && message.text && message.text.includes('button')) {
        continue;
      }
      
      if (message.isUser) {
        // Add user message - filter out button click messages, we'll handle them special
        if (!message.isButtonClick) {
          messages.push({
            role: 'user',
            content: message.text
          });
        }
      } 
      else if (message.fromTool) {
        // For messages from tools, show them as assistant messages
        messages.push({
          role: 'assistant',
          content: message.text
        });
      } 
      else {
        // Bot messages that aren't from tools are just normal assistant messages
        messages.push({
          role: 'assistant',
          content: message.text
        });
      }
    }
  }
  
  // Add button click context information if available
  if (hasButtonClick || threadState.lastButtonSelection) {
    // Use our helper function to add button context
    messages = addButtonClickInfoToContext(messages, threadState);
  }
  
  // Most recent tool execution results for context
  if (typeof threadState.getToolExecutionHistory === 'function') {
    const toolHistory = threadState.getToolExecutionHistory(5);
    let toolResultsText = '';
    
    if (toolHistory.length > 0) {
      toolResultsText = `Recent tool executions:\n`;
      toolHistory.forEach((execution, i) => {
        const success = execution.error ? '❌ FAILED' : '✅ SUCCESS';
        toolResultsText += `[${i+1}] ${execution.toolName} (${success})\n`;
      });
      
      // Add recent tool executions as a system message
      messages.push({
        role: 'system',
        content: toolResultsText
      });
    }
  }
  
  // Add button selection info specifically for the LLM
  if (threadState.lastButtonSelection) {
    const selection = threadState.lastButtonSelection;
    const selectionTime = new Date(selection.timestamp).toISOString();
    
    // Add this as debugging info that won't be shown to the user
    console.log("\nButton selection:");
    console.log(`Value: ${selection.value}`);
    console.log(`Text: ${selection.text}`);
    console.log(`Time: ${selectionTime}`);
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
          
          // Preprocess JSON to handle literal newlines and common issues before parsing
          cleanedArgs = preprocessLlmJson(cleanedArgs);
          
          // Log the preprocessed JSON for debugging
          if (process.env.DEBUG_JSON === 'true') {
            console.log("Preprocessed JSON:", cleanedArgs);
          }
          
          // Parse the cleaned JSON
          parameters = JSON.parse(cleanedArgs);
          console.log("Successfully parsed tool parameters");
        } catch (error) {
          console.log(`Error parsing tool parameters: ${error.message}`);
          
          // Attempt to recover using button extraction or text extraction
          console.log("Attempting to recover from JSON parsing error");
          
          // First, try to recover button information if this is a button message
          const buttonInfo = extractButtonInfo(toolCall.function.arguments);
          
          // Get the text content using more advanced regex that handles escaped chars
          const textMatch = toolCall.function.arguments.match(/"text"\s*:\s*"((?:\\.|[^"\\])*)"/);
          
          // Create a simple valid parameters object with what we can recover
          parameters = { 
            reasoning: "Recovered from JSON parsing error"
          };
          
          // Add text if we extracted it
          if (textMatch && textMatch[1]) {
            // Properly handle escaped characters in the recovered text
            // Convert Unicode and special escape sequences back to characters
            let extractedText = textMatch[1];
            
            // Handle special case of double-escaped newlines (\\n should become \n)
            extractedText = extractedText.replace(/\\\\n/g, '\\n');
            
            // Now evaluate the string with escape sequences
            try {
              // Evaluate the string with proper JSON parsing to handle escapes
              extractedText = JSON.parse(`"${extractedText.replace(/"/g, '\\"')}"`);
            } catch (evalError) {
              console.log(`Error evaluating extracted text: ${evalError.message}`);
              // If evaluation fails, use the text as-is but still fix basic escapes
              extractedText = extractedText
                .replace(/\\n/g, '\n')
                .replace(/\\t/g, '\t')
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, '\\');
            }
            
            parameters.text = extractedText;
            console.log("Recovered text content from damaged JSON");
          } else {
            parameters.text = "I couldn't process that correctly. Please try again with a simpler request.";
            console.log("Could not recover text content, using fallback message");
          }
          
          // Add buttons if we found them and this is a button message
          if (buttonInfo.buttons.length > 0 && toolName === 'createButtonMessage') {
            parameters.buttons = buttonInfo.buttons;
            console.log(`Added ${buttonInfo.buttons.length} recovered buttons to parameters`);
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
    console.log('🔍 Attempting to extract button information');
    
    // First check for #buttons syntax in block builder format
    const buttonMatch = jsonString.match(/#buttons:\s*\[(.*?)\]/s);
    if (buttonMatch) {
      console.log("FOUND BUTTON DEFINITION IN TEXT: ", buttonMatch[0]);
      const buttonContent = buttonMatch[1];
      
      // Parse button content into button objects
      try {
        const buttonDefinitions = buttonContent.split(',').map(btn => btn.trim());
        console.log(`📋 Button definitions found (${buttonDefinitions.length}):`, buttonDefinitions);
        
        result.buttons = buttonDefinitions.map((buttonDef, index) => {
          const parts = buttonDef.split('|').map(part => part.trim());
          console.log(`🔘 Button ${index + 1} parts:`, parts);
          
          return {
            text: parts[0],
            value: parts[1] || `option${index + 1}`,
            style: parts[2] || undefined
          };
        });
        console.log(`✅ Parsed ${result.buttons.length} buttons from #buttons syntax`);
        console.log(`📦 Button objects:`, JSON.stringify(result.buttons, null, 2));
      } catch (btnError) {
        console.log(`❌ Error parsing button definitions: ${btnError.message}`);
      }
      
      return result;
    }
    
    // Then check for "actions" array in the raw JSON (Slack legacy format)
    const actionsMatch = jsonString.match(/"actions"\s*:\s*\[([\s\S]*?)\]/);
    if (actionsMatch) {
      console.log("FOUND ACTIONS ARRAY IN JSON");
      try {
        const actionsText = actionsMatch[1];
        // Parse action objects from the actions array
        const actionObjects = extractObjectsFromJsonArray(actionsText);
        
        console.log(`Found ${actionObjects.length} action objects`);
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
        console.log(`✅ Extracted ${result.buttons.length} buttons from actions array`);
        console.log(`📦 Button objects:`, JSON.stringify(result.buttons, null, 2));
      } catch (actionsError) {
        console.log(`❌ Error parsing actions array: ${actionsError.message}`);
      }
      
      return result;
    }
    
    // Finally check for direct "buttons" array in the JSON
    const buttonsMatch = jsonString.match(/"buttons"\s*:\s*\[([\s\S]*?)\]/);
    if (buttonsMatch) {
      console.log("FOUND BUTTONS ARRAY IN JSON");
      try {
        const buttonsText = buttonsMatch[1];
        
        // Check if it's a simple string array ["Option 1", "Option 2"]
        const stringMatches = buttonsText.match(/"([^"]*)"/g);
        if (stringMatches) {
          console.log(`📋 String buttons found (${stringMatches.length}):`, stringMatches);
          
          result.buttons = stringMatches.map((match, index) => {
            const text = match.replace(/"/g, '');
            console.log(`🔘 Button ${index + 1} text: "${text}"`);
            
            // Check if this is pipe-separated format like "Feijoada|feijoada|primary"
            if (text.includes('|')) {
              const parts = text.split('|').map(part => part.trim());
              console.log(`🔀 Splitting button ${index + 1} by pipes:`, parts);
              
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
          console.log(`✅ Extracted ${result.buttons.length} buttons from string array`);
          console.log(`📦 Button objects:`, JSON.stringify(result.buttons, null, 2));
          return result;
        }
        
        // Otherwise try to parse as object array
        const buttonObjects = extractObjectsFromJsonArray(buttonsText);
        console.log(`📋 Button objects found (${buttonObjects.length})`);
        
        result.buttons = buttonObjects.map((objStr, index) => {
          const textMatch = objStr.match(/"text"\s*:\s*"([^"]*)"/);
          const valueMatch = objStr.match(/"value"\s*:\s*"([^"]*)"/);
          const styleMatch = objStr.match(/"style"\s*:\s*"([^"]*)"/);
          
          let text = textMatch ? textMatch[1] : `Option ${index + 1}`;
          console.log(`🔘 Button ${index + 1} text: "${text}"`);
          
          // Check if text contains pipe-separated format
          if (text.includes('|')) {
            const parts = text.split('|').map(part => part.trim());
            console.log(`🔀 Splitting button ${index + 1} by pipes:`, parts);
            
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
        console.log(`✅ Extracted ${result.buttons.length} buttons from object array`);
        console.log(`📦 Button objects:`, JSON.stringify(result.buttons, null, 2));
      } catch (buttonsError) {
        console.log(`❌ Error parsing buttons array: ${buttonsError.message}`);
      }
    }
  } catch (error) {
    console.log(`❌ Error in extractButtonInfo: ${error.message}`);
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
  console.log("\n--- DETAILED CONTEXT LOG ---");
  
  // Log message history
  console.log("Messages in threadState:", threadState.messages?.length || 0);
  if (threadState.messages && threadState.messages.length > 0) {
    console.log("Thread message history:");
    threadState.messages.forEach((msg, idx) => {
      const userType = msg.isUser ? 'USER' : 'BOT';
      const noteType = msg.isSystemNote ? 'SYSTEM NOTE' : '';
      const buttonType = msg.isButtonClick ? 'BUTTON CLICK' : '';
      const textPreview = msg.text?.substring(0, 50) + (msg.text?.length > 50 ? '...' : '');
      console.log(`[${idx + 1}] ${userType}: ${noteType} ${buttonType} ${textPreview}`);
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
  
  // Log button selection info if available
  if (threadState.lastButtonSelection) {
    console.log("\nButton selection:");
    console.log(`Value: ${threadState.lastButtonSelection.value}`);
    console.log(`Text: ${threadState.lastButtonSelection.text}`);
    console.log(`Time: ${threadState.lastButtonSelection.timestamp}`);
  }
  
  console.log("-------------------------");
}

module.exports = {
  getNextAction,
  processJsonStringParameters,
  formatToolResponse,
  getBrazilDateTime,
  preprocessLlmJson,
  extractButtonInfo,
  
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
