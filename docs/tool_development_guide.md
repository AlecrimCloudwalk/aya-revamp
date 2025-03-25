# Tool Development Guide

This guide explains how to create and implement new tools for the Slack bot while maintaining consistent logging, tracking, and thread state management.

## Overview of the Tool System

The bot uses a modular tool system with consistent patterns for:
- Tool registration and discovery
- Logging and error handling
- Thread state tracking
- Content recording in conversation history
- Duplicate detection

## Step 1: Create Your Tool Module

Create a new file in `src/tools/` for your tool. Follow this template:

```javascript
// src/tools/yourToolName.js

// Import necessary dependencies
const { logError } = require('../errors.js');
// Import any other dependencies needed

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
    // Validate arguments
    if (!args.param1) {
      throw new Error('param1 is required');
    }
    
    // Get channel from thread state
    const channelId = threadState.context.channelId;
    if (!channelId) {
      throw new Error('Channel ID not found in thread context');
    }
    
    // Implement tool logic here
    // ...
    
    // Return standardized result
    return {
      ok: true,
      // Add any tool-specific data to return
      // This data will be available to the LLM
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

## Step 2: Register Your Tool

Add your tool to the tool registry in `src/tools/index.js`:

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

## Step 3: Update Content Tracking (Optional)

If your tool produces content that should be tracked in the thread history, update the `trackToolContentInThread` function in `src/orchestrator.js`:

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

## Step 4: Using Your Tool

There are two ways to use your tool:

### Option 1: Via LLM (Primary Method)

The LLM will select and call your tool through the orchestrator's processThread function.

### Option 2: Directly Via processTools Module

For cases where you need to call the tool programmatically:

```javascript
const { processTool } = require('../processThread');
const { getThreadState } = require('../orchestrator');

async function useYourTool(context) {
  // Get thread state
  const threadState = getThreadState(context);
  
  // Define tool parameters
  const toolArgs = {
    param1: 'value1',
    param2: 'value2'
  };
  
  // Process the tool with consistent logging and tracking
  const result = await processTool('yourToolName', toolArgs, threadState);
  
  // Handle the result
  if (result.error) {
    console.error('Tool execution failed:', result.response.message);
  } else {
    console.log('Tool executed successfully:', result.response);
  }
  
  return result;
}
```

## Best Practices

1. **Error Handling**: Always include try/catch with proper error logging
2. **Validation**: Validate all required arguments
3. **Idempotency**: When possible, make tools idempotent (safe to run multiple times)
4. **Logging**: Let the orchestrator handle logging - don't add extensive custom logging
5. **State Updates**: Always update thread state through the provided methods
6. **Testing**: Create unit tests for your tool in `tests/tools/`

## Example Implementation

See `src/examples/toolUsage.js` for examples of how to use the modular tool processing system.

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