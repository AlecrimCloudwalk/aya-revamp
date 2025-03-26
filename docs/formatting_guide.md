# Slack Bot Formatting Guide

This document provides a comprehensive overview of all available formatting options for messages sent through our Slack bot.

## Basic Message Options

These parameters can be passed to the `postMessage` tool:

| Parameter | Type | Description |
|-----------|------|-------------|
| `title` | String | Main message title (appears as a header) |
| `text` | String | Primary message content (supports Slack markdown) |
| `subtitle` | String | Smaller text displayed below the title |
| `color` | String | Message color (hex code or named color like 'good', 'warning', 'danger') |
| `fields` | Array | Field items for two-column layout |
| `actions` | Array | Interactive buttons to add to the message |
| `threadTs` | String | Thread timestamp to reply in |
| `channel` | String | Channel ID to post in (usually handled automatically) |

## Rich Elements

The `elements` array parameter allows adding various rich content blocks:

```javascript
await postMessage({
  title: "Message with Rich Elements",
  elements: [
    // Various element types here
  ]
}, threadState);
```

### Available Element Types

| Type | Description | Properties |
|------|-------------|------------|
| `divider` | Horizontal divider line | None |
| `header` | Section header | `text` |
| `context` | Small text elements | `text` |
| `bullet_list` | Bulleted list | `items` (array of strings) |
| `numbered_list` | Numbered list | `items` (array of strings) |
| `quote` | Blockquote | `text` |
| `image` | Image embed | `url`, `alt`, `title` |
| `code` | Code block | `code`, `language` |
| `table` | Tabular data | `headers` (array), `rows` (array of arrays) |
| `column` | Multi-column layout | `columns` (array of content) |
| `accordion` | Collapsible sections | `sections` (array with `title` and `content`) |
| `timeline` | Progress/status timeline | `steps` (array with `title`, `description`, and `status`) |
| `info` | Info notice | `title`, `text` |
| `warning` | Warning notice | `title`, `text` |
| `error` | Error notice | `title`, `text` |
| `success` | Success notice | `title`, `text` |

## Advanced Message Components

### Rich Header

```javascript
await postMessage({
  richHeader: {
    text: "Header with Icon",
    emoji: "🚀", // Either emoji or icon
    icon: "https://example.com/icon.png" // Image URL
  }
}, threadState);
```

### Tables

```javascript
await postMessage({
  title: "Data Table",
  table: {
    headers: ["Name", "Role", "Department"],
    rows: [
      ["John Doe", "Developer", "Engineering"],
      ["Jane Smith", "Designer", "UX/UI"]
    ]
  }
}, threadState);
```

### Multi-Column Layout

```javascript
await postMessage({
  title: "Two Columns",
  columns: [
    "*Left Column*\nContent for the left column.",
    "*Right Column*\nContent for the right column."
  ]
}, threadState);
```

### Accordion Sections

```javascript
await postMessage({
  title: "Collapsible Sections",
  accordion: [
    {
      title: "Section 1",
      content: "Content for section 1"
    },
    {
      title: "Section 2",
      content: "Content for section 2"
    }
  ]
}, threadState);
```

### Timeline/Progress

```javascript
await postMessage({
  title: "Project Timeline",
  timeline: [
    {
      title: "Step 1",
      description: "Description of step 1",
      status: "completed" // completed, current, pending, error
    },
    {
      title: "Step 2",
      description: "Description of step 2",
      status: "current"
    },
    {
      title: "Step 3",
      description: "Description of step 3",
      status: "pending"
    }
  ]
}, threadState);
```

### Alert Blocks

```javascript
await postMessage({
  elements: [
    {
      type: "info", // or warning, error, success
      title: "Information",
      text: "This is an informational message."
    }
  ]
}, threadState);
```

### Interactive Buttons

```javascript
await postMessage({
  title: "Interactive Message",
  text: "Please select an option:",
  actions: [
    { 
      text: "Primary Button", 
      value: "primary_action", 
      style: "primary" 
    },
    { 
      text: "Secondary Button", 
      value: "secondary_action" 
    },
    { 
      text: "Dangerous Action", 
      value: "dangerous_action", 
      style: "danger",
      confirm: {
        title: "Are you sure?",
        text: "This action cannot be undone.",
        ok: "Yes, proceed",
        cancel: "Cancel"
      }
    }
  ]
}, threadState);
```

## Slack Markdown Support

All text content supports Slack's markdown format:

| Format | Markdown |
|--------|----------|
| Bold | `*bold*` |
| Italic | `_italic_` |
| Strikethrough | `~strikethrough~` |
| Code | `` `code` `` |
| Code block | ``````` ```language\ncode\n``` ``````` |
| Quote | `>quote` |
| Bulleted list | `• item` |
| Numbered list | `1. item` |
| Links | `<https://example.com|Link text>` |
| User mention | `<@USER_ID>` |
| Channel mention | `<#CHANNEL_ID>` |

## Color Reference

Predefined colors:

- `good` - Green
- `warning` - Yellow
- `danger` - Red

Or use hex color codes like `#36C5F0` (Slack blue).

## Examples

For a complete demonstration of all formatting capabilities, see the `test_formatting.js` script in the root directory.

## Best Practices

1. Use consistent styling and colors throughout your bot's messages
2. Group related information into sections
3. Use color to indicate message type or importance
4. Use interactive elements when expecting user input
5. Format code using the code blocks for better readability
6. Use tables for structured data
7. Use columns for side-by-side comparison
8. Use timelines to show sequential progress
9. Use accordion sections for complex, hierarchical information
10. Use alerts to highlight important information 