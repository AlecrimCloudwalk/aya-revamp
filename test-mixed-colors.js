// Test for mixed default colors and explicitly specified colors

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

// Import the parseMessage function
const { parseMessage } = require('./src/toolUtils/blockBuilder');
const { normalizeColor } = require('./src/toolUtils/messageFormatUtils');

// Test with a message that has mixed colors
async function testMixedColors() {
  console.log('\n=== TESTING MIXED COLORS WITH OVERRIDE ===\n');
  
  // Create a message with mixed colors - some blocks have explicit colors, others use default
  const mixedMessage = `#header: Message with Mixed Colors
  
#section: This section uses the default color
  
#section: This section has an explicit red color|color:#E01E5A
  
#section: This section also uses the default color
  
#context: This context has an explicit green color|color:#2EB67D`;
  
  console.log('Input message with mixed colors:');
  console.log('--------------------------------');
  console.log(mixedMessage);
  console.log('--------------------------------\n');
  
  // Parse the message
  console.log('Parsing message...');
  const parsedMessage = await parseMessage(mixedMessage);
  console.log('\nParsed message with original colors:');
  console.log(JSON.stringify(parsedMessage, null, 2));
  
  // Count blocks with default and explicit colors
  if (parsedMessage.attachments && parsedMessage.attachments.length > 0) {
    const defaultColor = '#842BFF';
    const defaultColorBlocks = parsedMessage.attachments.filter(a => a.color === defaultColor);
    const explicitColorBlocks = parsedMessage.attachments.filter(a => a.color !== defaultColor);
    
    console.log(`\nBefore override: Found ${defaultColorBlocks.length} blocks with default color and ${explicitColorBlocks.length} with explicit colors`);
    
    // Apply color override logic
    console.log('\nApplying override with color: #ECB22E (yellow)');
    const messageParams = { ...parsedMessage };
    const args = { color: '#ECB22E' }; // Yellow color in args
    const normalizedColor = normalizeColor(args.color);
    
    // Apply color to attachments
    if (messageParams.attachments && messageParams.attachments.length > 0) {
      messageParams.attachments.forEach((attachment, index) => {
        const isDefaultColor = attachment.color === defaultColor;
        console.log(`Attachment ${index + 1}: Color = ${attachment.color}, isDefault = ${isDefaultColor}`);
        
        if (isDefaultColor || !attachment.color) {
          console.log(`  - Replacing color ${attachment.color} with ${normalizedColor}`);
          attachment.color = normalizedColor;
        } else {
          console.log(`  - Keeping existing color ${attachment.color} (not default)`);
        }
      });
    }
    
    // Check the results
    console.log('\nAfter override:');
    const defaultColorBlocksAfter = messageParams.attachments.filter(a => a.color === defaultColor);
    const yellowBlocks = messageParams.attachments.filter(a => a.color === normalizedColor);
    const otherColorBlocks = messageParams.attachments.filter(a => a.color !== defaultColor && a.color !== normalizedColor);
    
    console.log(`- ${defaultColorBlocksAfter.length} blocks with default color (should be 0)`);
    console.log(`- ${yellowBlocks.length} blocks with yellow color (overridden from default)`);
    console.log(`- ${otherColorBlocks.length} blocks with other explicit colors (preserved)`);
    
    console.log('\nFinal colors:');
    messageParams.attachments.forEach((attachment, index) => {
      console.log(`Attachment ${index + 1}: ${attachment.color}`);
    });
  }
}

// Run the test
testMixedColors().catch(error => {
  console.error('Error running test:', error);
}); 