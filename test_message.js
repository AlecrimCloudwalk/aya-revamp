// Test script for Slack message sending

// Import dependencies
const { getSlackClient } = require('./src/slackClient.js');
const { postMessage } = require('./src/tools/postMessage.js');

// Main function
async function testSlackMessage() {
  console.log('Starting message test...');
  
  try {
    // Create a mock thread state
    const threadState = {
      context: {
        channelId: process.env.TEST_CHANNEL_ID || 'your-channel-id', // Configure in env or update here
        threadTs: null // Not in a thread, posting to channel
      },
      messages: [],
      toolResults: [],
      sentContentMessages: []
    };
    
    // Test message with blocks and rich content
    const messageArgs = {
      title: 'Test Message',
      text: 'This is a test message to verify the fix for duplicate content',
      color: '#36a64f', // Green color
      fields: [
        { title: 'Field 1', value: 'Value 1' },
        { title: 'Field 2', value: 'Value 2' }
      ]
    };
    
    console.log('Sending test message...');
    const result = await postMessage(messageArgs, threadState);
    
    console.log('Message sent successfully:');
    console.log(JSON.stringify(result, null, 2));
    
    console.log('Test completed!');
  } catch (error) {
    console.error('Error in test:', error);
  }
}

// Run the test
testSlackMessage(); 