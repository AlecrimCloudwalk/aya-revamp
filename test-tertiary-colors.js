// Test for tertiary colors in Slack messages

// Mock environment variables to avoid errors
process.env.SLACK_BOT_TOKEN = 'mock_token';
process.env.SLACK_SIGNING_SECRET = 'mock_secret';
process.env.SLACK_APP_TOKEN = 'mock_app_token';
process.env.LLM_API_KEY = 'mock_llm_key';

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

// Test correct and incorrect tertiary color message formatting
async function testTertiaryColors() {
  console.log('\n=== TESTING TERTIARY COLOR FORMATTING ===\n');
  
  // WRONG FORMAT - No color parameter specified
  const wrongFormat = `#header: Tertiary Colors (WRONG FORMAT)

#section: Orange
#section: Purple
#section: Teal`;
  
  console.log('WRONG FORMAT (no color parameter):');
  console.log('----------------------------------');
  console.log(wrongFormat);
  console.log('----------------------------------\n');
  
  console.log('Parsing wrong format message...');
  const parsedWrongFormat = await parseMessage(wrongFormat);
  
  console.log('\nParsed Result (WRONG FORMAT):');
  console.log('----------------------------------');
  if (parsedWrongFormat.attachments && parsedWrongFormat.attachments.length > 0) {
    parsedWrongFormat.attachments.forEach((attachment, i) => {
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
  console.log('----------------------------------\n');
  
  // CORRECT FORMAT - With color parameter specified
  const correctFormat = `#header: Tertiary Colors (CORRECT FORMAT)

#section: Orange|color:#FF9A00
#section: Purple|color:#9C27B0
#section: Teal|color:#009688`;
  
  console.log('CORRECT FORMAT (with color parameter):');
  console.log('----------------------------------');
  console.log(correctFormat);
  console.log('----------------------------------\n');
  
  console.log('Parsing correct format message...');
  const parsedCorrectFormat = await parseMessage(correctFormat);
  
  console.log('\nParsed Result (CORRECT FORMAT):');
  console.log('----------------------------------');
  if (parsedCorrectFormat.attachments && parsedCorrectFormat.attachments.length > 0) {
    parsedCorrectFormat.attachments.forEach((attachment, i) => {
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
  console.log('----------------------------------\n');
  
  console.log('COMPARING THE TWO RESULTS:');
  console.log('----------------------------------');
  console.log('Wrong format - Number of attachments:', parsedWrongFormat.attachments?.length || 0);
  console.log('Correct format - Number of attachments:', parsedCorrectFormat.attachments?.length || 0);
  console.log('----------------------------------');
  
  // Check the colors of each attachment
  console.log('\nCOLORS IN WRONG FORMAT:');
  if (parsedWrongFormat.attachments && parsedWrongFormat.attachments.length > 0) {
    parsedWrongFormat.attachments.forEach((attachment, i) => {
      console.log(`  Attachment ${i + 1}: ${attachment.color}`);
    });
  }
  
  console.log('\nCOLORS IN CORRECT FORMAT:');
  if (parsedCorrectFormat.attachments && parsedCorrectFormat.attachments.length > 0) {
    parsedCorrectFormat.attachments.forEach((attachment, i) => {
      console.log(`  Attachment ${i + 1}: ${attachment.color}`);
    });
  }
}

// Run the test
testTertiaryColors().catch(error => {
  console.error('Error running test:', error);
}); 