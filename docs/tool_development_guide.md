# Tool Development Guide

This guide explains how to create and implement new tools for the Slack bot while maintaining the LLM-driven architecture principles.

## Core Principles

1. **LLM Agency**: Tools must not make decisions about user intent or message flow - all decisions are made by the LLM
2. **Consistent Interface**: All tools follow the same parameter format and state tracking mechanisms
3. **No Duplication**: Always check `function_index.md` to ensure similar functionality doesn't already exist
4. **State Management**: Always use ThreadState for tracking tool execution and state

## Tool Implementation Pattern

All tools follow this standard pattern:

```javascript
// src/tools/yourToolName.js

const { logError } = require('../errors.js');

/**
 * Tool description - what it does and when to use it
 * 
 * @param {Object} args - Arguments for the tool
 * @param {string} args.param1 - Description of first parameter
 * @param {string} args.param2 - Description of second parameter
 * @param {Object} threadState - Current thread state
 * @returns {Promise<Object>} - Result of tool execution
 */
async function yourToolName(args, threadState) {
  try {
    // Validate required arguments
    if (!args.param1) {
      throw new Error('param1 is required');
    }
    
    // Get channel from thread state
    const channelId = threadState.context.channelId;
    if (!channelId) {
      throw new Error('Channel ID not found in thread context');
    }
    
    // Implement tool logic
    // ...
    
    // Return standardized result
    return {
      ok: true,
      // Add any tool-specific data to return to the LLM
    };
  } catch (error) {
    logError('Error executing yourToolName', error, { args });
    throw error; // Rethrow to be handled by the executeToolWithLogging wrapper
  }
}

module.exports = {
  yourToolName
};
```

## Tool Registration

After creating your tool, register it in the tool registry:

1. Add your tool to `src/tools/index.js`:

```javascript
// Import your tool
const { yourToolName } = require('./yourToolName.js');

// Add to the toolRegistry
const toolRegistry = {
  // ... existing tools
  
  yourToolName: {
    name: 'yourToolName',
    description: 'Clear description of what your tool does',
    function: yourToolName,
    parameters: {
      param1: 'Description of first parameter',
      param2: 'Description of second parameter (optional)'
    },
    isAsync: false // Set to true if tool runs asynchronously
  }
};
```

2. Update `function_index.md` with a description of your tool and its functions.

## ThreadState Integration

The ThreadState class is central to tool execution. It provides:

- Tool execution tracking and deduplication
- Button state management 
- Metadata storage for thread context

Always use ThreadState methods when implementing tools:

```javascript
// Record a tool execution
threadState.recordToolExecution(toolName, args, result);

// Check if a tool has been executed
if (threadState.hasExecuted(toolName, args)) {
  // Get previous result
  const prevResult = threadState.getToolResult(toolName, args);
}

// Store metadata
threadState.setMetadata('key', value);

// Retrieve metadata
const value = threadState.getMetadata('key');
```

## Content Tracking (Optional)

If your tool produces content that should be tracked in thread history, update the `trackToolContentInThread` function in `src/orchestrator.js`:

```javascript
function trackToolContentInThread(toolName, toolArgs, threadState, requestId) {
  switch (toolName) {
    // ... existing cases
    
    case 'yourToolName':
      // If your tool produces content that should be shown in thread history
      if (toolArgs.contentField) {
        let messageText = `**Your Tool Result**\n\n${toolArgs.contentField}`;
        
        addMessageToThread(threadState, {
          text: messageText,
          isUser: false,
          timestamp: new Date().toISOString(),
          threadTs: threadState.context.threadTs,
          fromTool: true,
          requestId: requestId
        });
      }
      break;
  }
}
```

## Testing Your Tool

Create unit tests for your tool in the `tests/tools/` directory:

```javascript
// tests/tools/yourToolName.test.js
const { yourToolName } = require('../../src/tools/yourToolName');

describe('yourToolName', () => {
  test('should handle valid parameters', async () => {
    const args = { param1: 'value1', param2: 'value2' };
    const threadState = {
      context: { channelId: 'C12345' },
      recordToolExecution: jest.fn()
    };
    
    const result = await yourToolName(args, threadState);
    expect(result.ok).toBe(true);
    // Add more assertions as needed
  });
  
  test('should throw error when missing required parameters', async () => {
    const args = { param2: 'value2' }; // Missing param1
    const threadState = {
      context: { channelId: 'C12345' }
    };
    
    await expect(yourToolName(args, threadState)).rejects.toThrow('param1 is required');
  });
});
```

## Best Practices

1. **Error Handling**: Always include try/catch with proper error logging
2. **Validation**: Validate all required arguments at the beginning of your function
3. **Idempotency**: When possible, make tools idempotent (safe to run multiple times)
4. **State Updates**: Always update thread state through the provided methods
5. **No Decision Making**: Your tool should not make decisions about what to do next - all decisions must be made by the LLM
6. **Return Format**: Always return a structured object with at least an `ok` property indicating success/failure

## Common Issues and Solutions

### Tool Not Found
- Check that the tool is properly registered in `src/tools/index.js`
- Verify spelling matches exactly

### Thread State Issues
- Always check that you have a valid threadState.context.channelId
- Use `getThreadState(context)` to initialize thread state

### Duplicated Messages
- The system will automatically detect and prevent duplicate messages
- If you need to override this, provide a unique parameter like timestamp

## Reference: Core Tools

Here are some of the core tools that your new tool might need to interact with:

- **postMessage**: Posts formatted messages to Slack
- **updateMessage**: Updates existing Slack messages
- **getThreadHistory**: Retrieves thread history from Slack
- **finishRequest**: Signals the end of processing for a user request 