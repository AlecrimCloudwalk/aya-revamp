// Simple test for hex color values

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

// Test normalizeColor function
console.log("\n=== TESTING HEX COLOR NORMALIZATION ===\n");
console.log('Hex color with #: ', normalizeColor('#0078D7'));
console.log('Hex color without #: ', normalizeColor('0078D7'));
console.log('Invalid color: ', normalizeColor('blue'));
console.log('No color provided: ', normalizeColor());

// Test a message with proper format for the regex to match correctly
const hexColorMessage = `#section: This is blue colored text.|color:#0078D7
#section: This is red colored text.|color:#E01E5A
#context: This is purple context text.|color:#6B46C1`;

// Test parsing the message
async function testHexColorMessage() {
  console.log('\n=== TESTING HEX COLORS IN MESSAGE ===\n');
  console.log('Input message:');
  console.log('--------------------------------');
  console.log(hexColorMessage);
  console.log('--------------------------------\n');
  
  console.log('Parsing message...');
  try {
    const parsedMessage = await parseMessage(hexColorMessage);
    
    console.log('\nParsed message:');
    console.log('--------------------------------');
    console.log(JSON.stringify(parsedMessage, null, 2));
    console.log('--------------------------------\n');
    
    // Verify colors
    if (parsedMessage.attachments && parsedMessage.attachments.length > 0) {
      console.log(`Found ${parsedMessage.attachments.length} attachments with colors:`);
      parsedMessage.attachments.forEach((attachment, i) => {
        console.log(`Attachment ${i + 1}: Color = ${attachment.color}`);
      });
    } else {
      console.log('No attachments or colors found in parsed message');
    }
  } catch (error) {
    console.error('Error parsing message:', error);
  }
}

// Run the test
testHexColorMessage().catch(error => {
  console.error('Error running test:', error);
}); 