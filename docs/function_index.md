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
  - `buildButtons(options)` - Builds formatted button elements
  - `createSection(text)` - Creates a section block with text
  - `createHeader(text)` - Creates a header block
  - `createDivider()` - Creates a divider block
  - `createContext(text)` - Creates a context block with text
  - `isValidBlock(block)` - Validates if an object is a valid Slack block

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
- **Purpose**: Posts messages to Slack
- **Functions**:
  - `postMessage(args, threadState)` - Posts a message to Slack with improved block handling
  - `processUserMentions(text)` - Processes user mentions in message text

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

### `src/tools/updateButtonMessage.js`
- **Purpose**: Updates interactive button messages
- **Functions**:
  - `updateButtonMessage(args, threadState)` - Updates a button message to highlight the selected button

### `src/tools/updateMessage.js`
- **Purpose**: Updates existing Slack messages
- **Functions**:
  - `updateMessage(args, threadState)` - Updates an existing message in Slack

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