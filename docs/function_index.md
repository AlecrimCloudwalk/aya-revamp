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
      - `elements` - Rich content elements
      - `table` - Tabular data display
      - `columns` - Multi-column layout
      - `accordion` - Collapsible sections
      - `timeline` - Progress/status indicators
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
  - `createTableBlocks(tableData)` - Creates blocks for tabular data with options:
      - `headers` - Array of column header names
      - `rows` - Array of arrays for row data
  - `createColumnBlocks(columnData)` - Creates multi-column layout blocks with options:
      - `columns` - Array of markdown-formatted column content
  - `createAccordionBlocks(accordionData)` - Creates collapsible section blocks with options:
      - `sections` - Array of objects with `title` and `content` properties
  - `createTimelineBlocks(timelineData)` - Creates timeline/progress blocks with options:
      - `steps` - Array of objects with `title`, `description`, and `status` properties
  - `createInfoBlock(infoData)` - Creates an info notice block with title and text
  - `createAlertBlock(alertData, alertType)` - Creates alert blocks (warning/error/success) with title and text
  - `normalizeColor(color)` - Converts named colors to proper hex values
  - `processUserMentions(text)` - Processes user mentions in message text
  - `parseRichText(text)` - Parses text with formatting markers into Block Kit blocks
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
    - **Advanced Formatting Support**:
      - Rich headers with emoji/icons
      - Tabular data display
      - Multi-column layouts
      - Collapsible sections (accordion)
      - Timeline/progress indicators
      - Alert blocks (info, warning, error, success)
      - Interactive buttons with confirmations
      - Structured lists (bullet, numbered)
      - Code blocks with language highlighting
      - Quote blocks and context sections
    - **Key Parameters**:
      - `title` - Message title displayed as header
      - `text` - Main message content with Slack markdown support
      - `subtitle` - Secondary text below the title
      - `color` - Message color (hex code or named colors like 'good', 'warning', 'danger')
      - `richHeader` - Enhanced header with emoji/icon support
      - `fields` - Two-column data display with title/value pairs
      - `actions` - Interactive buttons with style and confirmation options
      - `table` - Tabular data with headers and rows
      - `columns` - Multi-column layout for side-by-side content
      - `accordion` - Collapsible sections with title and content
      - `timeline` - Progress/status visualization with completed/current/pending states
      - `elements` - Array of rich content blocks including alerts, lists, quotes, and more
  - `formatMessageWithAbstraction(args, channel)` - Formats messages using high-level abstractions
    - Converts simplified formatting options to Slack Block Kit format
    - Handles rich content layout construction for all advanced components
    - Processes color normalization for consistent message styling
    - Manages text content parsing for markers and special formatting
  - `normalizeColor(color)` - Converts named colors to proper hex values
  - `processUserMentions(text)` - Processes user mentions in message text
  - `parseRichText(text)` - Parses text with formatting markers into Block Kit blocks
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
    - **Supports All Formatting Options**:
      - Same advanced formatting capabilities as postMessage
      - Ability to completely transform message appearance
      - Full support for tables, columns, timeline, and accordion layouts
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