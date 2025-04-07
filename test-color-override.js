// Test script to verify that color specified in args will override the default color
const { parseMessage } = require('./src/toolUtils/blockBuilder');
const { normalizeColor } = require('./src/toolUtils/messageFormatUtils');

// Mock the logger to avoid dependencies
global.logger = {
  info: console.log,
  debug: console.log,
  detail: console.log,
  warn: console.warn,
  error: console.error
};

// Mock necessary functions
global.debugLog = (msg) => console.log(`DEBUG: ${msg}`);

async function testColorOverride() {
  console.log("\n=== TESTING COLOR OVERRIDE ===\n");
  
  // Case 1: Simple section without color in content, using args color
  const simpleMessage = "#section: This is a section without color in content";
  
  console.log("Case 1: Processing simple section with args color");
  console.log("------------------------------------------------");
  console.log("Input message:", simpleMessage);
  
  // Parse the message
  const result1 = await parseMessage(simpleMessage);
  console.log("\nParsed message result:");
  console.log(JSON.stringify(result1, null, 2));
  
  // Check for default color and simulate override
  if (result1.attachments && result1.attachments.length > 0) {
    console.log(`\nAttachment has color: ${result1.attachments[0].color}`);
    console.log("Simulating color override with args.color = #ECB22E");
    
    // Mock color override logic from postMessage.js
    const args = { color: "#ECB22E" };
    const normalizedColor = normalizeColor(args.color);
    console.log(`Normalized color: ${normalizedColor}`);
    
    const defaultColor = "#842BFF";
    const attachment = result1.attachments[0];
    const isDefaultColor = attachment.color === defaultColor;
    
    console.log(`Is default color: ${isDefaultColor}`);
    
    if (isDefaultColor || !attachment.color) {
      console.log(`Replacing color ${attachment.color || 'none'} with ${normalizedColor}`);
      attachment.color = normalizedColor;
    }
    
    console.log(`\nAfter override, attachment has color: ${attachment.color}`);
  }
  
  console.log("\n------------------------------------------------");
  
  // Case 2: Section with color in content, using args color
  const coloredMessage = "#section: This is a section with color in content|color:#E01E5A";
  
  console.log("\nCase 2: Processing section with color in content and args color");
  console.log("------------------------------------------------");
  console.log("Input message:", coloredMessage);
  
  // Parse the message
  const result2 = await parseMessage(coloredMessage);
  console.log("\nParsed message result:");
  console.log(JSON.stringify(result2, null, 2));
  
  // Check the color from content
  if (result2.attachments && result2.attachments.length > 0) {
    console.log(`\nAttachment has color: ${result2.attachments[0].color}`);
    console.log("Simulating color override with args.color = #ECB22E");
    
    // Mock color override logic from postMessage.js
    const args = { color: "#ECB22E" };
    const normalizedColor = normalizeColor(args.color);
    console.log(`Normalized color: ${normalizedColor}`);
    
    const defaultColor = "#842BFF";
    const attachment = result2.attachments[0];
    const isDefaultColor = attachment.color === defaultColor;
    
    console.log(`Is default color: ${isDefaultColor}`);
    
    if (isDefaultColor || !attachment.color) {
      console.log(`Replacing color ${attachment.color || 'none'} with ${normalizedColor}`);
      attachment.color = normalizedColor;
    } else {
      console.log(`Keeping existing color ${attachment.color} (not default)`);
    }
    
    console.log(`\nAfter override logic, attachment has color: ${attachment.color}`);
  }
}

// Run the test
testColorOverride().catch(error => {
  console.error('Error running test:', error);
}); 