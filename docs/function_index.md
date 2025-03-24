# Function and Tool Index

This document maintains a comprehensive index of all functions and tools in the codebase. **ALWAYS** consult this index before creating new functionality to prevent duplication.

## Core Files

### `src/main.js`
- **Purpose**: Application entry point that sets up Slack Bolt or Express
- **Functions**: 
  - *TBD*

### `src/orchestrator.js`
- **Purpose**: Manages the flow between Slack events, LLM, and tools
- **Functions**:
  - `handleIncomingSlackMessage(context)` - Processes incoming Slack messages and mentions
  - `handleButtonClick(context)` - Handles interactive button clicks from Slack with deduplication
  - `processThread(threadState)` - Processes a thread with the LLM with loop detection and prevention
  - `executeToolAction(action, threadState, requestId)` - Executes a tool based on LLM action
  - `executeAsyncOperation(operationId, toolFunction, toolArgs, threadState, toolName, toolCallId)` - Executes async tools
  - `getThreadState(context)` - Gets or initializes thread state
  - `addMessageToThread(threadState, message)` - Adds a message to thread history
  - `addToolResultToThread(threadState, toolResult)` - Adds tool result to thread
  - `cleanupThread(threadState)` - Cleans up thread state after processing
  - `extractFullMessageContent(message)` - Extracts text content from Slack message
  - `enrichWithThreadStats(threadState)` - Adds thread statistics to thread state
  - `trackLastResponses(threadState)` - Tracks recent responses to detect loops

### `src/llmInterface.js`
- **Purpose**: Handles communication with the LLM
- **Functions**:
  - `getNextAction(threadState)` - Gets the next action from the LLM
  - `sendRequestToLLM(requestBody, threadState, isRetry)` - Sends request to LLM API
  - `getSystemMessage(context)` - Gets system message for LLM context
  - `formatMessagesForLLM(threadState)` - Formats messages for LLM with special handling for button clicks
  - `formatToolResponse(toolName, args, response)` - Formats tool response for LLM
  - `getSystemInstructions(context)` - Gets system instructions for LLM with button interaction guidance
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
  - `buildButtons(options)` - Builds formatted button elements
  - `createSection(text)` - Creates a section block with text
  - `createHeader(text)` - Creates a header block
  - `createDivider()` - Creates a divider block
  - `createContext(text)` - Creates a context block with text
  - `isValidBlock(block)` - Validates if an object is a valid Slack block

### `src/config.js`
- **Purpose**: Manages configuration and environment variables
- **Functions**:
  - *TBD*

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
  - `getTool(name)` - Gets a specific tool function by name
  - `isAsyncTool(name)` - Checks if a tool is asynchronous
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
  - `createButtonMessage(args, threadState)` - Creates a message with interactive buttons and stores metadata for context tracking

### `src/tools/updateButtonMessage.js`
- **Purpose**: Updates interactive button messages
- **Functions**:
  - `updateButtonMessage(args, threadState)` - Updates a button message to highlight the selected button, adds confirmation dialogs to other buttons

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

## Utility Functions

### General Utilities
- *TBD*

## Message Formatting Functions
- *TBD*

---

*Note: This index will be populated as functions are implemented. All new functions and tools MUST be added to this index with clear descriptions of their purpose.* 