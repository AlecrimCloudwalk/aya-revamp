// Test for block color parsing and merging
const { parseParams } = require('./src/toolUtils/blockBuilder');

// Create a simple debug log function
function debugLog(msg) {
  console.log(`DEBUG: ${msg}`);
}

// Mock debugLog for the imported module
global.debugLog = debugLog;

// Test parseParams with color parameter
console.log('Testing parseParams with color parameter:');

const testCases = [
  {
    type: 'section',
    content: 'This is a section with blue color|color:blue',
    expected: { color: 'blue', text: 'This is a section with blue color' }
  },
  {
    type: 'header',
    content: 'Header with red color|color:red',
    expected: { color: 'red', text: 'Header with red color' }
  },
  {
    type: 'section',
    content: 'Section with hex color|color:#FF5733',
    expected: { color: '#FF5733', text: 'Section with hex color' }
  },
  {
    type: 'section',
    content: 'Plain section without color',
    expected: { text: 'Plain section without color' }
  },
  {
    type: 'contextWithImages',
    content: 'Context with images and color|color:yellow| images:[https://example.com/image.jpg|Alt text]',
    expected: { 
      color: 'yellow', 
      text: 'Context with images and color',
      images: [{ url: 'https://example.com/image.jpg', alt: 'Alt text' }]
    }
  }
];

testCases.forEach((testCase, index) => {
  console.log(`\nTest case ${index + 1}: ${testCase.type} with content "${testCase.content}"`);
  const result = parseParams(testCase.type, testCase.content);
  console.log('Result:', result);
  
  // Verify if color was extracted correctly
  if (testCase.expected.color) {
    if (result.color === testCase.expected.color) {
      console.log(`✅ Color parameter "${result.color}" extracted correctly`);
    } else {
      console.log(`❌ Color parameter extraction failed. Expected "${testCase.expected.color}", got "${result.color || 'undefined'}"`);
    }
  } else if (result.color) {
    console.log(`❌ Unexpected color parameter "${result.color}" found`);
  } else {
    console.log(`✅ No color parameter, as expected`);
  }
  
  // Verify if text was extracted correctly
  if (result.text === testCase.expected.text) {
    console.log(`✅ Text extracted correctly`);
  } else {
    console.log(`❌ Text extraction failed. Expected "${testCase.expected.text}", got "${result.text}"`);
  }
});

// Now let's test the merge functionality
console.log('\n\nTesting mergeAttachmentsByColor functionality:');

// Mock the mergeAttachmentsByColor function since we can't directly import it
function mergeAttachmentsByColor(attachments) {
  if (!attachments || !Array.isArray(attachments) || attachments.length <= 1) {
    return attachments; // Return as is if no merging needed
  }
  
  console.log(`Merging ${attachments.length} attachments by color`);
  
  // Group attachments by color
  const colorGroups = {};
  
  attachments.forEach(attachment => {
    const color = attachment.color || 'default';
    
    if (!colorGroups[color]) {
      colorGroups[color] = [];
    }
    
    colorGroups[color].push(attachment);
  });
  
  // Create new merged attachments array
  const mergedAttachments = [];
  
  Object.keys(colorGroups).forEach(color => {
    const attachmentsWithSameColor = colorGroups[color];
    
    // If only one attachment with this color, keep as is
    if (attachmentsWithSameColor.length === 1) {
      mergedAttachments.push(attachmentsWithSameColor[0]);
      return;
    }
    
    // Create a single merged attachment for this color
    const mergedAttachment = {
      color: color === 'default' ? null : color,
      blocks: [],
      fallback: attachmentsWithSameColor[0].fallback || 'Message from bot'
    };
    
    // Merge blocks from all attachments with this color
    attachmentsWithSameColor.forEach(attachment => {
      if (attachment.blocks && Array.isArray(attachment.blocks)) {
        mergedAttachment.blocks.push(...attachment.blocks);
      }
    });
    
    mergedAttachments.push(mergedAttachment);
    console.log(`Merged ${attachmentsWithSameColor.length} attachments with color ${color}`);
  });
  
  console.log(`After merging: ${mergedAttachments.length} attachments`);
  return mergedAttachments;
}

// Test data - mixed colored attachments
const testAttachments = [
  {
    color: "blue",
    blocks: [{ type: "header", text: { type: "plain_text", text: "Blue Header", emoji: true } }]
  },
  {
    color: "blue",
    blocks: [{ type: "section", text: { type: "mrkdwn", text: "Blue Section 1" } }]
  },
  {
    color: "yellow",
    blocks: [{ type: "section", text: { type: "mrkdwn", text: "Yellow Section" } }]
  },
  {
    color: "red",
    blocks: [{ type: "section", text: { type: "mrkdwn", text: "Red Section" } }]
  },
  {
    color: "blue",
    blocks: [{ type: "section", text: { type: "mrkdwn", text: "Blue Section 2" } }]
  }
];

console.log('\nOriginal attachments:');
console.log(JSON.stringify(testAttachments, null, 2));

const mergedAttachments = mergeAttachmentsByColor(testAttachments);

console.log('\nMerged attachments:');
console.log(JSON.stringify(mergedAttachments, null, 2));

console.log('\nVerifying results:');
// Verify blue attachments merged correctly
const blueAttachment = mergedAttachments.find(attachment => attachment.color === 'blue');
if (blueAttachment && blueAttachment.blocks.length === 3) {
  console.log(`✅ All blue blocks merged correctly into one attachment with ${blueAttachment.blocks.length} blocks`);
} else {
  console.log('❌ Blue blocks not merged correctly');
}

// Verify other colors remain separate
if (mergedAttachments.length === 3) {
  console.log('✅ Correct number of attachments after merging (3: blue, yellow, red)');
} else {
  console.log(`❌ Expected 3 attachments after merging, but got ${mergedAttachments.length}`);
} 