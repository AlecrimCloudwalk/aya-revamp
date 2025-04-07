// Test for multi-colored message blocks

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
const { mergeAttachmentsByColor } = require('./src/toolUtils/messageFormatUtils');

// This is a test message formatted as how the LLM would send it after learning
// about the color syntax
const coloredMessage = `#header: Different Colored Sections

#section: This is a blue-colored section.|color:#0078D7

#section: This is a green-colored section.|color:#2EB67D

#section: This is a red-colored section.|color:#E01E5A

#context: Each section has its own color bar.|color:#6B46C1`;

// Test the full pipeline
async function testColoredMessage() {
  console.log('\n=== TESTING MULTI-COLORED MESSAGE ===\n');
  console.log('Input message from LLM:');
  console.log('--------------------------------');
  console.log(coloredMessage);
  console.log('--------------------------------\n');
  
  console.log('Parsing message...');
  const parsedMessage = await parseMessage(coloredMessage);
  
  console.log('\nParsed blocks:');
  console.log('--------------------------------');
  if (parsedMessage.attachments && parsedMessage.attachments.length > 0) {
    parsedMessage.attachments.forEach((attachment, i) => {
      console.log(`Attachment ${i + 1}:`);
      console.log(`  Color: ${attachment.color}`);
      console.log(`  Block count: ${attachment.blocks ? attachment.blocks.length : 0}`);
      
      if (attachment.blocks && attachment.blocks.length > 0) {
        attachment.blocks.forEach((block, j) => {
          console.log(`    Block ${j + 1}: ${block.type}`);
          if (block.text) {
            console.log(`      Text: ${block.text.text}`);
          }
        });
      }
    });
  }
  console.log('--------------------------------\n');
  
  // Now test the merge function
  console.log('Testing merge function:');
  console.log('--------------------------------');
  console.log(`Before merging: ${parsedMessage.attachments ? parsedMessage.attachments.length : 0} attachments`);
  
  if (parsedMessage.attachments && parsedMessage.attachments.length > 0) {
    const mergedAttachments = mergeAttachmentsByColor(parsedMessage.attachments);
    console.log(`After merging: ${mergedAttachments.length} attachments`);
    
    console.log('\nVerifying colors were preserved:');
    const colorSet = new Set(mergedAttachments.map(a => a.color));
    console.log(`Found ${colorSet.size} unique colors: ${Array.from(colorSet).join(', ')}`);
    
    console.log('\nFinal merged attachments:');
    mergedAttachments.forEach((attachment, i) => {
      console.log(`Attachment ${i + 1}:`);
      console.log(`  Color: ${attachment.color}`);
      console.log(`  Block count: ${attachment.blocks ? attachment.blocks.length : 0}`);
      
      if (attachment.blocks && attachment.blocks.length > 0) {
        attachment.blocks.forEach((block, j) => {
          console.log(`    Block ${j + 1}: ${block.type}`);
          if (block.text) {
            console.log(`      Text: ${block.text.text}`);
          }
        });
      }
    });
  }
  console.log('--------------------------------\n');
}

// Run the test
testColoredMessage().catch(error => {
  console.error('Error running test:', error);
}); 