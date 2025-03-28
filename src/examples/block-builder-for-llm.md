# Block Builder Reference Guide for LLM

This guide shows how to use the Block Builder syntax to create rich Slack messages.

## Basic Syntax

The Block Builder uses the following syntax:

```
#blockType: content | param1:value1 | param2:value2
```

Multiple blocks can be combined in a single message:

```
#blockType1: content
#blockType2: another content
```

## Supported Block Types

### Basic Blocks

#### Header
```
#header: Welcome to our Service!
```

#### Section (standard text)
```
#section: This is a standard section with text content.
```

#### Context (smaller helper text)
```
#context: Additional information shown in smaller text
```

#### Divider (horizontal line)
```
#divider:
```

#### Image
```
#image: https://example.com/image.jpg | altText:Image description
```

### Complex Blocks

#### Context with Images
```
#contextWithImages: Here are some examples | images:[https://example.com/image1.jpg|First Image, https://example.com/image2.jpg|Second Image]
```

#### Buttons
```
#buttons: [Approve|approve_action|primary, Reject|reject_action|danger, More Info|info_action]
```

Button format: `[Text|value|style, Text2|value2|style2]`

Styles: `primary` (green), `danger` (red), or omit for default (gray)

#### Fields (for displaying data in columns)
```
#fields: [*Field 1 Title*|Field 1 Value, *Field 2 Title*|Field 2 Value]
```

## Complete Examples

### Example 1: Simple Message
```
#header: Welcome to our App!

#section: Thank you for installing our app. Here's how to get started.

#divider:

#buttons: [Get Started|start_btn|primary, Read Docs|docs_btn, Contact Support|support_btn]
```

### Example 2: Message with Images and Fields
```
#header: Monthly Report

#section: Here's your account summary for the month of June.

#contextWithImages: Account Activity | images:[https://example.com/chart.jpg|Activity Chart]

#divider:

#fields: [*Balance*|$1,250, *Transactions*|43, *Status*|Good Standing]

#section: Would you like to take any actions?

#buttons: [View Details|view_details|primary, Download PDF|download_pdf, Contact Support|contact_support]
```

### Example 3: User Information
```
#header: User Profile

#section: Here's your profile information.

#contextWithImages: Your current avatar | images:[https://secure.gravatar.com/avatar/205e460b479e2e5b48aec07710c08d50|Your Profile Picture]

#fields: [*Name*|John Doe, *Email*|john@example.com, *Plan*|Premium, *Member Since*|January 2022]

#divider:

#section: You can update your profile at any time.

#buttons: [Edit Profile|edit_profile|primary, Change Avatar|change_avatar, View Settings|view_settings]
```

## How to Use in a Tool Call

When sending a message, include the Block Builder syntax in the `text` parameter:

```json
{
  "tool": "postMessage",
  "reasoning": "Sending a formatted response to the user's question",
  "parameters": {
    "text": "#header: Your Question\\n\\n#section: Here's the answer to your question about our service.\\n\\n#divider:\\n\\n#buttons: [Learn More|learn_more|primary, Contact Us|contact_us]",
    "color": "blue"
  }
}
```

## Best Practices

1. Use headers to make the message topic clear
2. Separate content with dividers for readability
3. Group related information into sections
4. Use fields for displaying structured data
5. Include buttons for interactive actions
6. Use images to enhance visual appeal
7. Keep context text brief and helpful 