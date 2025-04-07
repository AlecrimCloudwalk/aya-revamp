// Test full flow of message creation with color override

// First, mock the logger to avoid dependencies
global.logger = {
  info: console.log,
  debug: console.log,
  detail: console.log,
  warn: console.warn,
  error: console.error
};

// Mock necessary functions
global.debugLog = (msg) => console.log(`DEBUG: ${msg}`);

// Import required functions
const { parseMessage } = require('./src/toolUtils/blockBuilder');
const { normalizeColor } = require('./src/toolUtils/messageFormatUtils');

// Simulate the LLM's message flow
async function testFullMessageFlow() {
  console.log('\n=== TESTING FULL MESSAGE FLOW WITH COLOR OVERRIDE ===\n');
  
  // Simulate LLM sends a message with yellow color in args
  const llmMessage = {
    text: "#header: Status Report\n\n#section: Sample section without specific color",
    color: "#ECB22E" // Yellow color in args
  };
  
  console.log("1. LLM sends message with color specified in args:");
  console.log(JSON.stringify(llmMessage, null, 2));
  
  // Step 1: Parse the message content
  console.log("\n2. Parse the message content using BlockBuilder:");
  const parsedMessage = await parseMessage(llmMessage.text);
  console.log(JSON.stringify(parsedMessage, null, 2));
  
  // Step 2: Apply the color override from args
  console.log("\n3. Apply color override from args:");
  const messageParams = { ...parsedMessage };
  
  // Normalize the color
  const normalizedColor = normalizeColor(llmMessage.color);
  console.log(`   Normalized color from args: ${normalizedColor}`);
  
  // Apply color to attachments
  if (messageParams.attachments && messageParams.attachments.length > 0) {
    console.log(`   Before color override: ${messageParams.attachments.length} attachments`);
    
    messageParams.attachments.forEach((attachment, index) => {
      console.log(`   Attachment ${index + 1} has color: ${attachment.color}`);
      
      // Apply the color override logic
      const defaultColor = "#842BFF"; // The default Slack blue
      const isDefaultColor = attachment.color === defaultColor;
      
      if (isDefaultColor || !attachment.color) {
        console.log(`   Replacing color ${attachment.color} with ${normalizedColor}`);
        attachment.color = normalizedColor;
      } else {
        console.log(`   Keeping existing color ${attachment.color} (not default)`);
      }
    });
    
    console.log(`\n4. Final message structure after color override:`);
    console.log(JSON.stringify(messageParams, null, 2));
    
    console.log(`\n5. Final colors of attachments:`);
    messageParams.attachments.forEach((attachment, index) => {
      console.log(`   Attachment ${index + 1}: ${attachment.color}`);
    });
  }
}

// Run the test
testFullMessageFlow().catch(error => {
  console.error('Error running test:', error);
}); 