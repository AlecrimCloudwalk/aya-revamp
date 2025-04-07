# Message Formatting Guide

## Basic Message Structure
Messages in Slack are constructed from blocks, which are building blocks for rich messages. The bot supports multiple block types that you can combine to create rich, interactive messages.

## Block Types
- `#header`: Creates a large title/header
- `#section`: Creates a standard text section
- `#context`: Creates smaller helper text
- `#divider`: Creates a horizontal line separator

## Color Formatting

### Adding Colors to Blocks
You can add colors to individual blocks using the `|color:` syntax with hex color codes:

```
#section: This is a blue-colored section.|color:#0078D7
#section: This is a red-colored section.|color:#E01E5A
#section: This is a green-colored section.|color:#2EB67D
```

This creates a message with three differently colored sections, each with its own visual separator.

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

#### Tertiary Colors
```
#section: Orange|color:#FF9A00
#section: Purple|color:#9C27B0
#section: Teal|color:#009688
```

IMPORTANT: Always include the `|color:#HEXCODE` when specifying colors. Without this format, sections will inherit the default color.

### Supported Color Formats

Colors must be specified in hex format:
- Standard hex codes: `#0078D7`, `#E01E5A`, `#2EB67D`, `#ECB22E`, etc.
- Always use the # prefix followed by 6 hex characters
- Example colors:
  - Blue: `#0078D7`
  - Red: `#E01E5A`
  - Green: `#2EB67D`
  - Yellow: `#ECB22E`
  - Purple: `#6B46C1`

### Example: Multi-Colored Message

```
#header: Message with Different Colors
#section: This is the first section with blue color.|color:#0078D7
#divider:
#section: This is the second section with green color.|color:#2EB67D
#divider:
#section: This is the third section with red color.|color:#E01E5A
#context: Each section has its own color bar.|color:#6B46C1
```

### Behavior with Colors
- Blocks with the same color will be merged visually (sharing the same color bar)
- Blocks with different colors will remain separate
- If no color is specified, a default color (#0078D7) will be applied

## Advanced Formatting

### Images in Context
```
#contextWithImages: Text with images|color:#2EB67D| images:[https://example.com/image.jpg|Alt text]
```

### Buttons
```
#buttons: [Click me|button_value|primary, Cancel|cancel|danger]|color:#0078D7
```

### User Context
```
(usercontext)U123456,U234567|These users are collaborating(!usercontext)
``` 