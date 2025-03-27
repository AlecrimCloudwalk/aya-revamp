# Function and Tool Index

This document maintains a comprehensive index of all functions and tools in the codebase. **ALWAYS** consult this index before creating new functionality to prevent duplication.

## Core Files

### `src/main.js`
- **Purpose**: Application entry point that sets up Slack Bolt or Express
- **Functions**: 
  - `setupSlackEvents(app)` - Sets up Slack event handlers

### `src/threadState.js`
- **Purpose**: Centralized thread state management system
- **Classes**:
  - `ThreadState` - Core class for managing all thread-related state
    - **Methods**:
      - `recordToolExecution(toolName, args, result)` - Records a tool execution and its result
      - `hasExecuted(toolName, args)` - Checks if a tool has already been executed with specific args
      - `getToolResult(toolName, args)` - Retrieves previous result of a tool execution
      - `getButtonState(actionId)` - Gets the state and metadata for a button
      - `setButtonState(actionId, state, metadata)` - Updates a button's state
      - `setMetadata(key, value)` - Stores arbitrary metadata in thread state
      - `getMetadata(key)` - Retrieves metadata from thread state
      - `getStateForLLM()` - Returns a simplified state object for the LLM
- **Functions**:
  - `getThreadState(threadId)` - Gets or creates a ThreadState instance for a thread

### `src/orchestrator.js`
- **Purpose**: Manages the flow between Slack events, LLM, and tools
- **Functions**:
  - `handleIncomingSlackMessage(context)` - Processes incoming Slack messages using ThreadState
  - `handleButtonClick(context)` - Handles interactive button clicks using ThreadState
  - `processThread(threadState)` - Manages LLM interaction loop using ThreadState
  - `executeTool(toolName, args, threadState)` - Executes a tool with deduplication based on ThreadState

### `src/processThread.js`
- **Purpose**: Provides standardized tool processing for direct tool calls
- **Functions**:
  - `processTool(toolName, toolArgs, threadState)` - Processes a tool call with ThreadState tracking
  - `formatToolResponse(toolResult)` - Formats tool result for display or storage

### `src/llmInterface.js`
- **Purpose**: Handles communication with the LLM
- **Functions**:
  - `getNextAction(threadState)` - Gets the next action from the LLM, works with both ThreadState instances and simple objects
  - `sendRequestToLLM(requestBody, isRetry)` - Sends request to LLM API
  - `getSystemMessage(context)` - Gets system message for LLM context
  - `parseToolCallFromResponse(llmResponse)` - Parses tool calls from LLM response, handling "functions." prefixes
  - `getAvailableTools()` - Gets available tools for the LLM

### `src/slackEvents.js`
- **Purpose**: Processes incoming Slack events
- **Functions**:
  - `setupSlackEvents(app)` - Sets up Slack event handlers
  - `shouldProcessInDevMode(text)` - Checks if message should be processed in dev mode

### `src/slackFormat.js`
- **Purpose**: Provides formatting utilities for Slack messages
- **Functions**:
  - `formatSlackMessage(options)` - Enhanced formatting with rich elements support
    - **Key Parameters**:
      - `title` - Main message title (header)
      - `text` - Main message content (supports Slack markdown)
      - `color` - Message color (hex code or predefined colors)
      - `subtitle` - Smaller text below title
      - `fields` - Two-column layout items
      - `actions` - Interactive buttons
      - `elements` - Array of rich content elements (headers, dividers, bullet lists, etc.)
      - `richHeader` - Enhanced header with emoji/icon
  - `buildButtons(options)` - Builds formatted button elements
  - `createSection(text)` - Creates a section block with text
  - `createHeader(text)` - Creates a header block
  - `createDivider()` - Creates a divider block
  - `createContext(text)` - Creates a context block with text
  - `createRichHeader(options)` - Creates a header with icon/emoji and supports the following options:
      - `text` - The header text content
      - `emoji` - An emoji to display (e.g., "tada", "rocket")
      - `icon` - URL to an image icon
  - `normalizeColor(color)` - Converts named colors to proper hex values
  - `processUserMentions(text)` - Processes user mentions in message text
  - `createButtonsBlock(buttons)` - Creates an actions block with interactive buttons
  - `createFieldsBlock(fields)` - Creates section blocks for field display

### `src/config.js`
- **Purpose**: Manages configuration and environment variables
- **Functions**:
  - `LLM_API_KEY`, `LLM_API_URL`, `LLM_MODEL` - Configuration constants
  - `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN` - Slack API credentials

### `src/errors.js`
- **Purpose**: Error handling utilities
- **Functions**:
  - `logError(message, error, context)` - Logs an error with context
  - `formatErrorForLLM(error, context)` - Formats an error for the LLM
  - `createToolError(message, code)` - Creates standardized tool errors

## Tools

### `src/tools/index.js`
- **Purpose**: Tool registry
- **Functions**:
  - `getToolsForLLM()` - Gets tools metadata formatted for the LLM
  - `getTool(name)` - Gets a specific tool function by name, handles "functions." prefixes
  - `isAsyncTool(name)` - Checks if a tool is asynchronous, handles "functions." prefixes
  - `registerTool(name, description, func, parameters, isAsync)` - Registers a new tool

### `src/tools/postMessage.js`
- **Purpose**: Posts messages to Slack with rich formatting
- **Functions**:
  - `postMessage(args, threadState)` - Posts a message to Slack with advanced formatting capabilities
    - **Key Parameters**:
      - `text` - Main message content with Slack markdown support
      - `color` - Message color (hex code or named colors like 'good', 'warning', 'danger')
      - `buttons` - Array of button definitions with text, value, and style
      - `fields` - Array of field objects for two-column layouts
      - `images` - Array of image URLs or objects with url and alt_text
      - `blocks` - Direct Block Kit blocks for advanced layouts
      - `elements` - Array of rich content elements such as dividers, headers, bullet lists, etc.
      - `title` - Message title (alternative to header in text)
      - `richHeader` - Enhanced header with emoji/icon support
    - **Advanced Formatting Support**:
      - Rich headers with emoji/icons
      - Interactive buttons with confirmations
      - Structured lists (bullet, numbered)
      - Code blocks with language highlighting
      - Quote blocks and context sections
  - `formatMessageWithAbstraction(args, channel)` - Formats messages using high-level abstractions
    - Converts simplified formatting options to Slack Block Kit format
    - Handles rich content layout construction for all advanced components
    - Processes color normalization for consistent message styling
    - Manages text content parsing for markers and special formatting
  - `normalizeColor(color)` - Converts named colors to proper hex values
  - `processUserMentions(text)` - Processes user mentions in message text
  - `parseBBCode(text)` - Processes BBCode-style formatting tags into Slack markdown format
    - Handles headers, context blocks, user context, sections with images
    - Processes lists, dividers, image references 
    - Converts markdown links `[title](url)` to Slack format `<url|title>`
    - Advanced handling for hyperlinks with complex URLs and query parameters
    - Preprocessing for avatar links to prevent formatting issues
  - `parseBBCodeToBlocks(text)` - Parses BBCode-formatted text into Slack Block Kit blocks
  - `parseTextToBlocks(text)` - Direct parser for BBCode style tags to Slack blocks
  - `createButtonsBlock(buttons)` - Creates an actions block with interactive buttons
  - `createFieldsBlock(fields)` - Creates section blocks for field display

### `src/tools/finishRequest.js`
- **Purpose**: Signals the end of request processing
- **Functions**:
  - `finishRequest(args, threadState)` - Finalizes a request and performs cleanup

### `src/tools/getThreadHistory.js`
- **Purpose**: Retrieves thread history from Slack
- **Functions**:
  - `getThreadHistory(args, threadState)` - Gets message history from a thread
    - Formats messages, including attachments and image previews
    - Provides thread statistics and parent message context
    - Handles message formatting for optimal LLM understanding

### `src/tools/getUserAvatar.js`
- **Purpose**: Retrieves a user's profile avatar URLs
- **Functions**:
  - `getUserAvatar(args, threadState)` - Gets a user's avatar URLs in various sizes
    - **Key Parameters**:
      - `userId` - Slack user ID to get avatar for
      - `size` - Size of avatar to return (24, 32, 48, 72, 192, 512, 1024, or 'original')
    - **Returns**:
      - User profile information (name, display name)
      - URLs for all available avatar sizes
      - Specifically requested avatar URL

### `src/tools/createButtonMessage.js`
- **Purpose**: Creates interactive messages with buttons
- **Functions**:
  - `createButtonMessage(args, threadState)` - Creates a message with interactive buttons and stores metadata in ThreadState
    - **Key Parameters**:
      - `text` - Main message content
      - `title` - Message title (optional)
      - `color` - Message color (optional)
      - `buttons` - Array of button objects with text, value, and style properties
      - `channel` - Channel to post in (optional, defaults to event channel)
      - `actionPrefix` - Prefix for button action IDs (optional)
      - `metadata` - Additional data to store with button state (optional)
    - **Button Options**:
      - `text` - Button text to display
      - `value` - Value returned when button is clicked
      - `style` - Visual style ("primary", "danger", or default)
      - `confirm` - Confirmation dialog object with title, text, ok, and cancel properties
    - **Returns**:
      - Message timestamp for reference in updating the message later
      - Action IDs for each button created

### `src/tools/updateButtonMessage.js`
- **Purpose**: Updates interactive button messages
- **Functions**:
  - `updateButtonMessage(args, threadState)` - Updates a button message to highlight the selected button
    - **Key Parameters**:
      - `messageTs` - Timestamp of message to update
      - `channel` - Channel where message exists
      - `selectedValue` - Value of button to highlight as selected
      - `selectedState` - Object with text and/or color to show with selected button
      - `replaceButtons` - Whether to replace buttons with selection status (default: true)
      - `updatedText` - New message text content (optional)
    - **Returns**:
      - Updated message information and timestamp

### `src/tools/updateMessage.js`
- **Purpose**: Updates existing Slack messages
- **Functions**:
  - `updateMessage(args, threadState)` - Updates an existing message in Slack
    - **Key Parameters**:
      - `messageTs` - Timestamp of message to update
      - `channel` - Channel where message exists
      - `text` - Updated message text content
      - `title` - Updated message title (optional)
      - `color` - Updated message color (optional)
      - `fields` - Updated message fields (optional)
      - `actions` - Updated message buttons (optional)
      - `elements` - Updated rich elements (optional)
      - `richHeader` - Updated enhanced header (optional)
    - **Returns**:
      - Updated message information and timestamp

### `src/tools/createEmojiVote.js`
- **Purpose**: Creates and manages emoji-based voting
- **Functions**:
  - `createEmojiVote(args, threadState)` - Creates a message with emoji voting options
  - `getVoteResults(args, threadState)` - Gets current results for an emoji vote

### `src/tools/exampleTool.js`
- **Purpose**: Example tool for demonstration purposes
- **Functions**:
  - `exampleTool(args, threadState)` - Example tool implementation

## Architecture Design Patterns

### ThreadState Pattern
- **Purpose**: Centralized state management for threads
- **Key Components**:
  - `ThreadState` class - Single source of truth for thread data
  - Thread ID based lookup - Consistent access to thread state
  - Tool execution tracking - Prevents duplicate tool executions
  - Button state management - Tracks interactive elements

### Tool Execution Pattern
- **Purpose**: Standardized tool execution flow
- **Key Components**:
  - `executeTool` - Core function for executing tools with deduplication
  - `processTool` - Wrapper for direct tool calls
  - ThreadState integration - All tool calls update thread state

---

*Note: This index should be updated whenever significant changes are made to the codebase architecture or when new functions are added.* 