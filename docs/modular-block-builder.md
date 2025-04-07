# Modular Block Kit Builder

## Overview
A simplified, modular approach to building Slack Block Kit messages with a consistent syntax that makes it easy for the LLM to generate correct block structures without complex parsing or regex.

## Core Requirements
1. All blocks (except standalone images) must have the vertical color bar via attachment wrapping
2. Interface must be easy for the LLM to use without requiring perfect JSON generation
3. All text blocks must support Markdown formatting (bold, italic, etc.)
4. System must be modular and maintainable

## Block Syntax
The general syntax for blocks is:
```
#blockType: content | param1:value1 | param2:value2
```

## Block Types

### Basic Blocks

| Block Type | Description | Attachment Wrapped | Parameters |
|------------|-------------|-------------------|------------|
| `section` | Standard text section | Yes | text |
| `image` | Standalone image | No | url, altText |
| `context` | Smaller helper text | Yes | text |
| `divider` | Horizontal line separator | Yes | none |
| `header` | Larger header text | Yes | text |

### Compound Blocks

| Block Type | Description | Attachment Wrapped | Parameters |
|------------|-------------|-------------------|------------|
| `sectionWithImage` | Section with image accessory | Yes | text, imageUrl, imageAlt, imagePosition |
| `contextWithImages` | Context with multiple images | Yes | text, images array |
| `sectionWithUsers` | Section with user mentions | Yes | text, users array |
| `buttons` | Interactive button set | Yes | buttons array |
| `fields` | Multi-column field layout | Yes | fields array |

## Syntax Examples

### Basic Blocks

```
#section: This is a section with *bold* and _italic_ text

#image: https://example.com/image.jpg | Image description

#context: This appears in smaller text below

#divider:

#header: This is a header
```

### Compound Blocks

```
#sectionWithImage: This is text with an image. | image:https://example.com/image.jpg | alt:Image description | position:right

#contextWithImages: Design progress | images:[https://example.com/image1.jpg|Logo, https://example.com/image2.jpg|Colors]

#sectionWithUsers: Team members: | users:[U12345|Lead, U67890|Designer]

#buttons: [Approve|approve_action|primary, Decline|decline_action|danger]

#fields:
  - *Status:*|🟢 Active
  - *Owner:*|<@U12345>
  - *Due:*|Tomorrow
```

## Complete Message Example

```
#header: Daily Report Summary

#section: *Project Status:* _On Track_ ✅
The team has completed 85% of planned tasks for this sprint.

#divider:

#sectionWithImage: We've made significant progress on the redesign. | image:https://example.com/design_preview.jpg | alt:New design preview | position:bottom

#context: Updated 2 hours ago

#section: Tasks remaining:
• Finalize UI components
• Complete integration tests
• Deploy to staging

#divider:

#section: <@U12345> and <@U67890> have submitted pull requests for review.

#contextWithImages: Design variations | images:[https://example.com/image1.jpg|Version A, https://example.com/image2.jpg|Version B]

#context: Reply with your feedback below 👇
```

## Implementation Architecture

### 1. Block Registry
Central registry of block types, each with validators and generators:

```javascript
const blockRegistry = {
  section: {
    validate: (params) => { /* validation logic */ },
    generate: (params) => { /* block generation */ }
  },
  // other block types...
};
```

### 2. Block Definitions
Configuration for each block type:

```javascript
const blockDefinitions = {
  section: {
    params: ['text'],
    attachmentWrapped: true,
  },
  image: {
    params: ['url', 'altText'],
    attachmentWrapped: false,
  },
  // other block definitions...
};
```

### 3. Message Processing Flow

1. **Block Parsing**: Split message by block declarations (`#blocktype:`)
2. **Parameter Extraction**: Parse parameters based on block type
3. **Validation**: Validate parameters for each block
4. **Block Generation**: Generate Slack Block Kit JSON for each block
5. **Attachment Wrapping**: Wrap appropriate blocks in attachments for the color bar
6. **Message Assembly**: Combine all blocks into the final message format

### 4. Implementation Example

```javascript
function parseMessage(text) {
  // Split message by block declarations
  const blockMatches = text.matchAll(/#(\w+):(.*?)(?=#\w+:|$)/gs);
  const blocks = [];
  
  for (const match of blockMatches) {
    const [fullMatch, blockType, blockContent] = match;
    
    if (blockRegistry[blockType]) {
      const params = parseParams(blockType, blockContent.trim());
      
      if (blockRegistry[blockType].validate(params)) {
        const block = blockRegistry[blockType].generate(params);
        
        if (blockDefinitions[blockType].attachmentWrapped) {
          blocks.push({
            type: 'attachment',
            color: '#842BFF', // Default color
            blocks: [block]
          });
        } else {
          blocks.push(block);
        }
      }
    }
  }
  
  return blocks;
}
```

## Advantages of This Approach

1. **Modularity**: Each block type is self-contained and can be developed independently
2. **Simplicity**: Easy for the LLM to generate correct syntax
3. **Consistency**: Uniform approach to block creation
4. **Maintainability**: Easier to debug and extend
5. **Readability**: Clear structure makes it easier to understand message composition

## Migration Strategy

1. Create the new parser in parallel with existing system
2. Add basic block types first, then compound blocks
3. Update the LLM's system message to use the new syntax
4. Monitor for improved error rates
5. Phase out the old parser once stability is confirmed 