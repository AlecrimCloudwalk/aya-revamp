# Function and Tool Index

This document maintains a comprehensive index of all functions and tools in the codebase. **ALWAYS** consult this index before creating new functionality to prevent duplication.

## Core Files

### `src/main.js`
- **Purpose**: Application entry point that sets up Slack Bolt or Express
- **Functions**: 
  - `setupSlackEvents(app)` - Sets up Slack event handlers

### `src/contextBuilder.js`
- **Purpose**: Unified system for building and managing context for the LLM
- **Classes**:
  - `ContextBuilder` - Core class for managing all thread-related state
    - **Methods**:
      - `recordToolExecution(threadId, toolName, args, result, error, skipped)` - Records a tool execution and its result
      - `addMessage(message)` - Adds a message to the context
      - `setButtonState(threadTs, actionId, state, metadata)` - Updates a button's state
      - `getButtonState(threadTs, actionId)` - Gets the state and metadata for a button
      - `setMetadata(threadTs, key, value)` - Stores arbitrary metadata in thread state
      - `getMetadata(threadTs, key)` - Retrieves metadata from thread state
      - `getChannel(threadTs)` - Gets the channel ID for a thread
      - `getThreadTs(threadTs)` - Gets the parent thread timestamp
      - `getStateForLLM(threadTs)` - Returns a simplified state object for the LLM
      - `getActiveButtons(threadTs)` - Gets active buttons in a thread
      - `getThreadSummary(threadTs)` - Gets a summary of thread activity
      - `buildFormattedLLMContext(threadTs, options)` - Builds formatted context for the LLM
      - `hasExecuted(threadId, toolName, args)` - Checks if a tool has already been executed
      - `getToolResult(threadId, toolName, args)` - Retrieves previous result of a tool execution
- **Functions**:
  - `getContextBuilder()` - Gets or creates the singleton ContextBuilder instance

### `src/orchestrator.js`
- **Purpose**: Manages the flow between Slack events, LLM, and tools
- **Functions**:
  - `handleIncomingSlackMessage(context)` - Processes incoming Slack messages 
  - `handleButtonClick(context)` - Handles interactive button clicks
  - `processThread(threadState)` - Manages LLM interaction loop
  - `executeTool(toolName, args, threadState)` - Executes a tool with deduplication

### `src/processThread.js`
- **Purpose**: Provides standardized tool processing for direct tool calls
- **Functions**:
  - `processTool(toolName, toolArgs, threadState)` - Processes a tool call with state tracking
  - `formatToolResponse(toolResult)` - Formats tool result for display or storage

### `src/llmInterface.js`
- **Purpose**: Handles communication with the LLM
- **Functions**:
  - `getNextAction(threadState)` - Gets the next action from the LLM
  - `sendRequestToLLM(requestBody, isRetry)` - Sends request to LLM API
  - `getSystemMessage(context)` - Gets system message for LLM context
  - `parseToolCallFromResponse(llmResponse)` - Parses tool calls from LLM response
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
      - `elements` - Array of rich content elements
      - `richHeader` - Enhanced header with emoji/icon
  - `buildButtons(options)` - Builds formatted button elements
  - `createSection(text)` - Creates a section block with text
  - `createHeader(text)` - Creates a header block
  - `createDivider()` - Creates a divider block
  - `createContext(text)` - Creates a context block with text
  - `createRichHeader(options)` - Creates a header with icon/emoji
  - `normalizeColor(color)` - Converts named colors to proper hex values
  - `processUserMentions(text)` - Processes user mentions in message text
  - `createButtonsBlock(buttons)` - Creates an actions block with interactive buttons
  - `createFieldsBlock(fields)` - Creates section blocks for field display

### `src/buttonUpdater.js`
- **Purpose**: Handles updating button states and managing interactive components
- **Functions**:
  - `updateButtonState(options)` - Updates state of a button after interaction
  - `handleButtonComplete(context, buttonId, newState)` - Completes a button interaction
  - `createButtonResponse(options)` - Creates a formatted response to button clicks

### `src/slackClient.js`
- **Purpose**: Centralizes Slack API client access
- **Functions**:
  - `getSlackClient()` - Returns a configured Slack Web API client instance

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

### `src/openai.js`
- **Purpose**: OpenAI API client and utility functions
- **Functions**:
  - `getOpenAIClient()` - Returns configured OpenAI API client
  - `sendOpenAIRequest(context, options)` - Sends a request to OpenAI

## Tool Utilities

### `src/toolUtils/blockBuilder.js`
- **Purpose**: Builds Block Kit blocks for Slack messages
- **Functions**:
  - `parseBlocksFromText(text)` - Parses block declarations from text
  - `generateBlocksFromParams(blockType, params)` - Generates Slack blocks from parameters
  - `parseBlockParameters(blockType, content)` - Parses parameters for blocks
  - `validateParameters(blockType, params)` - Validates block parameters

### `src/toolUtils/logger.js`
- **Purpose**: Centralized logging system
- **Functions**:
  - `info(message)` - Logs informational messages
  - `warn(message)` - Logs warning messages
  - `error(message, error)` - Logs error messages
  - `debug(message, details)` - Logs debug messages
  - `setLogLevel(level)` - Sets the current log level

### `src/toolUtils/llmDebugLogger.js`
- **Purpose**: Specialized logger for LLM interactions
- **Functions**:
  - `logRequest(threadId, messages, tools)` - Logs LLM request details
  - `logResponse(threadId, response)` - Logs LLM response details
  - `writeToFile(threadId, type, data)` - Writes log data to file

### `src/toolUtils/messageFormatUtils.js`
- **Purpose**: Message formatting utilities
- **Functions**:
  - `formatSlackMessage(message)` - Formats Slack messages for display
  - `processMarkdown(text)` - Processes markdown syntax
  - `calculateTextSimilarity(text1, text2)` - Calculates similarity between texts

### `src/toolUtils/dateUtils.js`
- **Purpose**: Date and time formatting utilities
- **Functions**:
  - `formatTimestamp(timestamp)` - Formats a timestamp for display
  - `formatRelativeTime(timestamp)` - Formats a timestamp as relative time
  - `formatContextTimestamp(timestamp)` - Formats a timestamp for context

### `src/toolUtils/contextFormatter.js`
- **Purpose**: Formats context for the LLM
- **Functions**:
  - `formatThreadContext(messages, options)` - Formats thread messages for LLM
  - `formatToolExecution(toolExecution)` - Formats a tool execution for LLM

### `src/toolUtils/loadThreadHistory.js`
- **Purpose**: Loads thread history from Slack
- **Functions**:
  - `loadThreadHistory(threadTs, channelId, limit)` - Loads message history

## Tools

### `src/tools/index.js`
- **Purpose**: Tool registry
- **Functions**:
  - `getToolsForLLM()` - Gets tools metadata formatted for the LLM
  - `getTool(name)` - Gets a specific tool function by name
  - `isAsyncTool(name)` - Checks if a tool is asynchronous
  - `registerTool(name, description, func, parameters, isAsync)` - Registers a new tool

### `src/tools/postMessage.js`
- **Purpose**: Posts messages to Slack with rich formatting
- **Functions**:
  - `postMessage(args, threadState)` - Posts a message to Slack with advanced formatting capabilities
    - **Key Parameters**:
      - `text` - Main message content with Slack markdown support
      - `color` - Message color (hex code or named colors)
      - `buttons` - Array of button definitions
      - `fields` - Array of field objects for two-column layouts
      - `images` - Array of image URLs or objects with url and alt_text
      - `blocks` - Direct Block Kit blocks for advanced layouts
      - `elements` - Array of rich content elements
      - `title` - Message title
      - `richHeader` - Enhanced header with emoji/icon support

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

### `src/tools/updateMessage.js`
- **Purpose**: Updates existing Slack messages
- **Functions**:
  - `updateMessage(args, threadState)` - Updates an existing message in Slack

### `src/tools/createEmojiVote.js`
- **Purpose**: Creates and manages emoji-based voting
- **Functions**:
  - `createEmojiVote(args, threadState)` - Creates a message with emoji voting options
  - `getVoteResults(args, threadState)` - Gets current results for an emoji vote

### `src/tools/addReaction.js`
- **Purpose**: Adds emoji reactions to messages
- **Functions**:
  - `addReaction(args, threadState)` - Adds emoji reactions to a message
    - **Key Parameters**:
      - `emoji` - Emoji name(s) to react with (single string or array)
      - `messageTs` - Timestamp of message to react to
      - `message_id` - ID of message to react to
      - `reasoning` - Reason for adding the reaction

### `src/tools/removeReaction.js`
- **Purpose**: Removes emoji reactions from messages
- **Functions**:
  - `removeReaction(args, threadState)` - Removes emoji reactions from a message
    - **Key Parameters**:
      - `emoji` - Emoji name(s) to remove (single string or array)
      - `messageTs` - Timestamp of message to remove reaction from
      - `message_id` - ID of message to remove reaction from

## Architecture Design Patterns

### ContextBuilder Pattern
- **Purpose**: Centralized context management for threads
- **Key Components**:
  - `ContextBuilder` class - Single source of truth for thread data
  - Thread ID based lookup - Consistent access to thread state
  - Tool execution tracking - Prevents duplicate tool executions
  - Button state management - Tracks interactive elements

### Tool Execution Pattern
- **Purpose**: Standardized tool execution flow
- **Key Components**:
  - `executeTool` - Core function for executing tools with deduplication
  - `processTool` - Wrapper for direct tool calls
  - Context integration - All tool calls update thread context

---

*Note: This index should be updated whenever significant changes are made to the codebase architecture or when new functions are added.* 