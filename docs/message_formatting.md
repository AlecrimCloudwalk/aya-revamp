# Slack Message Formatting Guide

## Overview

This guide details the system for creating rich Slack messages with a simplified syntax designed specifically for LLM integration. It allows the LLM to create complex Block Kit messages without requiring detailed knowledge of Block Kit's structure.

## Block Syntax

The general syntax for blocks is:

```
#blockType: content | param1:value1 | param2:value2
```

## Supported Block Types

| Block Type | Description | Parameters |
|------------|-------------|------------|
| `section` | Standard text section | `text`, `color` |
| `header` | Large header text | `text`, `color` |
| `image` | Standalone image | `url`, `altText` |
| `context` | Smaller helper text | `text`, `color` |
| `divider` | Horizontal line separator | `color` |
| `contextWithImages` | Context with multiple images | `text`, `images`, `color` |
| `sectionWithImage` | Section with an image | `text`, `imageUrl`, `imageAlt`, `imagePosition`, `color` |
| `buttons` | Interactive button set | `buttons`, `color` |
| `fields` | Multi-column field layout | `fields`, `color` |

## Basic Blocks

### Section Block
```
#section: This is a standard section block with some text|color:#0078D7
```

### Header Block
```
#header: This Is A Header|color:#E01E5A
```

### Divider Block
```
#divider:|color:#2EB67D
```

### Image Block
```
#image: https://example.com/image.jpg | altText:An example image
```

### Context Block
```
#context: This appears in smaller text below|color:#ECB22E
```

## Color Formatting

### Color Palette Examples

#### Primary Colors
```
#section: Red|color:#E01E5A
#section: Blue|color:#0078D7
#section: Yellow|color:#ECB22E
```

#### Secondary Colors
```
#section: Green|color:#2EB67D
#section: Purple|color:#6B46C1
#section: Orange|color:#F2801E
```

### Behavior with Colors
- Blocks with the same color will be merged visually (sharing the same color bar)
- Blocks with different colors will remain separate
- If no color is specified, a default color (#0078D7) will be applied

## Advanced Blocks

### Context With Images
```
#contextWithImages: Here are some example images | images:[https://example.com/image1.jpg|First Image, https://example.com/image2.jpg|Second Image]|color:#2EB67D
```

### Section With Image
```
#sectionWithImage: This is text with an image. | image:https://example.com/image.jpg | alt:Image description | position:right|color:#0078D7
```

### Buttons
```
#buttons: [Click Me|btn_1|primary, Cancel|btn_2|danger, More Info|btn_3]|color:#E01E5A
```

### Fields (Multi-column layout)
```
#fields:|color:#6B46C1
  - *Status:*|🟢 Active
  - *Owner:*|<@U12345>
  - *Due:*|Tomorrow
```

## Complete Message Example

```
#header: Daily Report Summary|color:#0078D7

#section: *Project Status:* _On Track_ ✅
The team has completed 85% of planned tasks for this sprint.|color:#0078D7

#divider:|color:#0078D7

#sectionWithImage: We've made significant progress on the redesign. | image:https://example.com/design_preview.jpg | alt:New design preview | position:bottom|color:#2EB67D

#context: Updated 2 hours ago|color:#2EB67D

#section: Tasks remaining:
• Finalize UI components
• Complete integration tests
• Deploy to staging|color:#E01E5A

#divider:|color:#E01E5A

#buttons: [Approve|approve_action|primary, Decline|decline_action|danger]|color:#ECB22E

#context: Reply with your feedback below 👇|color:#ECB22E
```

## Important Guidelines

1. **Color Consistency**: Always specify colors using the `|color:#HEXCODE` format.
2. **Image Alt Text**: Always provide alternative text for images to ensure accessibility.
3. **Button Values**: When creating buttons, always provide a unique value for each button for proper identification.
4. **Text Formatting**: Slack markdown is supported (bold with `*text*`, italic with `_text_`, etc.)
5. **Interactive Elements**: All interactive elements (buttons, etc.) will be tracked in thread state.

## Implementation Notes

- The Block Builder parses messages by block declarations and processes each block's parameters.
- Validation is performed to ensure blocks are properly formatted.
- Blocks are dynamically assembled into the proper Slack Block Kit format.
- Array parameters (buttons, images, fields) support both simplified and detailed object formats.
- All blocks (except standalone images) have a vertical color bar via attachment wrapping. 