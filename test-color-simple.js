// Simple test for color formatting in Slack messages

// Mock environment variables
process.env.SLACK_BOT_TOKEN = 'mock_token';
process.env.SLACK_SIGNING_SECRET = 'mock_secret';
process.env.SLACK_APP_TOKEN = 'mock_app_token';
process.env.LLM_API_KEY = 'mock_llm_key';

// Mock the logger
console.log('Setting up mocks...');
global.logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  debug: (msg) => console.log(`[DEBUG] ${msg}`),
  detail: (msg) => console.log(`[DETAIL] ${msg}`),
  warn: (msg) => console.log(`[WARN] ${msg}`),
  error: (msg) => console.log(`[ERROR] ${msg}`)
};

// Mock necessary functions
global.debugLog = (msg) => console.log(`[DEBUG] ${msg}`);

try {
  // Import the parseMessage function
  console.log('Importing modules...');
  const { parseMessage } = require('./src/toolUtils/blockBuilder');

  // Run the test
  async function runTest() {
    console.log('\n=== COLOR FORMATTING TEST ===\n');
    
    // 1. Test with NO color parameter (wrong format)
    const wrongMessage = `#section: This is orange text without color parameter`;
    
    console.log('WRONG FORMAT:');
    console.log(wrongMessage);
    
    const wrongResult = await parseMessage(wrongMessage);
    console.log('\nRESULT (wrong format):');
    console.log(JSON.stringify(wrongResult, null, 2));
    
    // 2. Test WITH color parameter (correct format)
    const correctMessage = `#section: This is orange text with color parameter|color:#FF9A00`;
    
    console.log('\nCORRECT FORMAT:');
    console.log(correctMessage);
    
    const correctResult = await parseMessage(correctMessage);
    console.log('\nRESULT (correct format):');
    console.log(JSON.stringify(correctResult, null, 2));
    
    // Show the difference
    console.log('\nCOMPARISON:');
    console.log(`Wrong format color: ${wrongResult.attachments[0].color}`);
    console.log(`Correct format color: ${correctResult.attachments[0].color}`);
  }

  // Execute the test
  runTest().catch(err => {
    console.error('Test error:', err);
  });
} catch (error) {
  console.error('Setup error:', error);
} 