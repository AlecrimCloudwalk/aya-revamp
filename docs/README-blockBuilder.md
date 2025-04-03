# Slack Block Builder

A modular system for creating Slack Block Kit messages using a simplified syntax designed for LLM integration.

## Overview

This module provides a declarative, easy-to-use syntax for creating rich Slack messages with various block types. It's specifically designed to work well with LLM-generated content, allowing the LLM to create complex Slack messages without requiring detailed knowledge of Block Kit's structure.

## Key Features

- **Simple Syntax**: Uses a straightforward `#blockType: content | param1:value | param2:value` syntax
- **Multiple Block Types**: Supports section, header, image, context, divider, and compound blocks
- **Built-in Validation**: Validates parameters before creating blocks
- **Image Support**: Enhanced parsing for images, including handling of alt text with commas
- **Array Parameters**: Supports arrays of buttons, fields, and images with robust parsing
- **Error Handling**: Graceful fallbacks when parameters are invalid

## Supported Block Types

| Block Type | Description | Parameters |
|------------|-------------|------------|
| `section` | Standard text section | `text` |
| `header` | Large header text | `text` |
| `image` | Standalone image | `url`, `altText` |
| `context` | Smaller helper text | `text` |
| `divider` | Horizontal line separator | none |
| `contextWithImages` | Context with multiple images | `text`, `images` |
| `sectionWithImage` | Section with an image | `text`, `imageUrl`, `imageAlt`, `imagePosition` |
| `buttons` | Interactive button set | `buttons` |
| `fields` | Multi-column field layout | `fields` |

## Usage Examples

### Basic Blocks

```
#section: This is a standard section block with some text

#header: This Is A Header

#divider:

#image: https://example.com/image.jpg | altText:An example image
```

### Context With Images

```
#contextWithImages: Here are some example images | images:[https://example.com/image1.jpg|First Image, https://example.com/image2.jpg|Second Image]
```

### Buttons

```
#buttons: [Click Me|btn_1|primary, Cancel|btn_2|danger, More Info|btn_3]
```

### Complex Example

```
#header: Welcome to our App

#section: This is a modular system for creating Slack messages with a simplified syntax.

#contextWithImages: Here are some example images | images:[https://example.com/image1.jpg|First Example, https://example.com/image2.jpg|Second Example]

#divider:

#buttons: [Click Me|btn_1|primary, Cancel|btn_2|danger, More Info|btn_3]

#section: You can combine different blocks to create rich, interactive messages.
```

## Internal Architecture

- **Block Registry**: Central repository of block definitions, validators, and generators
- **Parameter Validators**: Type-checking for various parameter types
- **Block Generators**: Functions that generate the actual Block Kit JSON
- **Message Parser**: Extracts block declarations from text and processes them

## Implementation Notes

- The `parseParams` function includes special handling for complex parameter types like images with alt text containing commas
- Array parameters (buttons, images, fields) support both simplified and detailed object formats
- Blocks can be standalone or wrapped in attachments with color bars

## Testing

Several test files are included to validate different aspects of the Block Builder:
- `test-context-images.js`: Tests the parsing of images in context blocks
- `test-integration.js`: Tests multiple block types in a single message

## Future Enhancements

- Support for more block types (input fields, date pickers, etc.)
- Enhanced error reporting
- Additional parameter validation
- Custom block templates 