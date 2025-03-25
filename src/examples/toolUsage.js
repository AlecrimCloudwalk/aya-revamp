// Example of using the modular tool processing approach
const { processTool, formatToolResponse } = require('../processThread');
const { getThreadState } = require('../orchestrator');

/**
 * Example: How to use processTool for a postMessage call
 */
async function examplePostMessage() {
  console.log('Example: Sending a message using the modular tool processing approach');
  
  // Create a mock thread state (normally you'd get this from the orchestrator)
  const mockContext = {
    userId: 'U12345',
    channelId: 'C12345',
    threadTs: 'T12345',
    teamId: 'TEAM12345'
  };
  
  // Get or initialize thread state
  const threadState = getThreadState(mockContext);
  
  // Define message parameters
  const messageParams = {
    title: 'Example Message',
    text: 'This is an example message sent using the modular tool processing approach.',
    color: '#0078D7'
  };
  
  try {
    // Process the postMessage tool with tracking and logging
    const result = await processTool('postMessage', messageParams, threadState);
    
    // Format the result for display or logging
    const formattedResult = formatToolResponse(result);
    
    console.log('Tool execution complete:');
    console.log('- Status:', formattedResult.status);
    console.log('- Timestamp:', formattedResult.formattedTimestamp);
    console.log('- Message posted successfully:', result.response.ok);
    console.log('- Message ID:', result.response.ts);
    
    return formattedResult;
  } catch (error) {
    console.error('Error processing tool:', error);
    return { error: true, message: error.message };
  }
}

/**
 * Example: How to use processTool for a createButtonMessage call
 */
async function exampleButtonMessage() {
  console.log('Example: Creating a button message using the modular tool processing approach');
  
  // Create a mock thread state (normally you'd get this from the orchestrator)
  const mockContext = {
    userId: 'U12345',
    channelId: 'C12345',
    threadTs: 'T12345',
    teamId: 'TEAM12345'
  };
  
  // Get or initialize thread state
  const threadState = getThreadState(mockContext);
  
  // Define button message parameters
  const buttonParams = {
    title: 'Example Button Message',
    text: 'Please select an option:',
    color: '#0078D7',
    buttons: JSON.stringify([
      { text: 'Option 1', value: 'option1' },
      { text: 'Option 2', value: 'option2' }
    ]),
    callbackId: 'example_buttons'
  };
  
  try {
    // Process the createButtonMessage tool with tracking and logging
    const result = await processTool('createButtonMessage', buttonParams, threadState);
    
    console.log('Button message created successfully:', result.response.ok);
    console.log('Button message ID:', result.response.ts);
    
    return result;
  } catch (error) {
    console.error('Error creating button message:', error);
    return { error: true, message: error.message };
  }
}

/**
 * Example: Processing a custom tool
 */
async function processCustomTool(toolName, toolArgs, context) {
  console.log(`Processing custom tool "${toolName}" with modular approach`);
  
  // Get or initialize thread state
  const threadState = getThreadState(context);
  
  try {
    // Generate a custom request ID with tool name for easier tracking
    const requestId = `custom_${toolName}_${Date.now()}`;
    
    // Process the tool
    const result = await processTool(toolName, toolArgs, threadState, requestId);
    
    console.log(`Custom tool "${toolName}" executed successfully:`, result.response);
    return result;
  } catch (error) {
    console.error(`Error processing custom tool "${toolName}":`, error);
    return { error: true, message: error.message };
  }
}

// Export examples for use elsewhere
module.exports = {
  examplePostMessage,
  exampleButtonMessage,
  processCustomTool
};

// If this file is run directly, execute the examples
if (require.main === module) {
  console.log('Running tool usage examples...');
  
  // Run examples sequentially
  (async () => {
    try {
      await examplePostMessage();
      console.log('--------------------------');
      await exampleButtonMessage();
    } catch (error) {
      console.error('Error running examples:', error);
    }
  })();
} 