# Slack Bot (Aya)

An LLM-powered Slack bot that responds to messages and provides various tools.

## Setup

1. Make sure you have Node.js installed (v16 or higher)
2. Install dependencies:
   ```
   npm install
   ```
3. Set up environment variables:
   - Create a `.env` file in the root directory (or use the existing one)
   - Required variables are:
     - `SLACK_BOT_TOKEN`
     - `SLACK_APP_TOKEN`
     - `SLACK_SIGNING_SECRET`
     - `LLM_API_KEY`
     - `PORT` (optional, defaults to 3000)

## Running the Bot

### For Windows (PowerShell):

For development:
```powershell
npm run dev
```

For production:
```powershell
npm start
```

## Message Formatting

The bot supports rich text formatting for messages posted to Slack. There are three primary ways to create formatted messages:

### 1. Rich Text with Markers (Recommended)

Simply provide text content with special markers, and the bot will automatically parse and convert them to proper Block Kit formatting:

```javascript
{
  "tool": "postMessage",
  "parameters": {
    "text": "Hello! I'm using *rich text* formatting.\n\n# This is a header\n\nThis is a paragraph with some details.\n\n---\n\n> This is a context block that appears smaller",
    "color": "good",  // Sets the color of the left vertical bar (green)
    "title": "Optional title"  // Will appear as a header at the top
  }
}
```

#### Supported Markers in Text:

- **Headers**: Start a line with `#` followed by the header text
  ```
  # This becomes a header
  ```

- **Dividers**: Use `---` or `!divider!` on its own line
  ```
  ---
  ```

- **Context blocks**: Start a line with `>` followed by the context text
  ```
  > This becomes a smaller context text
  ```

- **Images**: Use `!image:URL:alt_text` on its own line
  ```
  !image:https://example.com/image.jpg:An example image
  ```

- **Emoji showcase**: Use `!emojis:` followed by comma-separated emoji names
  ```
  !emojis:tada,rocket,sparkles
  ```
  This creates a rich text block with multiple emojis displayed in a row.

- **Big emoji**: Use `!big-emoji:` followed by an emoji name for emphasis
  ```
  !big-emoji:tada
  ```
  This displays a single, larger emoji in a context block for emphasis.

- **Regular text** supports standard Slack markdown:
  - `*bold*` for **bold text**
  - `_italic_` for _italic text_
  - `` `code` `` for `code`
  - ``````code block`````` for code blocks
  - `~strikethrough~` for ~~strikethrough~~
  - Links: `<https://example.com|Click here>`
  - Emojis: `:smile:` for 😊

### 2. Interactive Elements as Parameters

Buttons, fields, and images can be added directly via parameters:

```javascript
{
  "tool": "postMessage",
  "parameters": {
    "text": "Basic message text",
    "buttons": [
      "Simple Button", 
      { "text": "Primary Button", "style": "primary" },
      { "text": "Danger Button", "style": "danger" },
      { "text": "URL Button", "url": "https://example.com" }
    ],
    "fields": [
      { "title": "Priority", "value": "High" },
      { "title": "Due Date", "value": "Friday, June 10" }
    ],
    "images": [
      "https://example.com/image.jpg",
      { "url": "https://example.com/image2.jpg", "alt_text": "Second image" }
    ]
  }
}
```

### 3. Advanced Layout Components (New)

The bot now supports sophisticated layout components for complex data presentation:

```javascript
{
  "tool": "postMessage",
  "parameters": {
    "title": "Project Status Dashboard",
    "text": "Here's the current status of our project.",
    "color": "blue",
    "table": {
      "headers": ["Task", "Owner", "Status"],
      "rows": [
        ["API Integration", "John", "In Progress"],
        ["Frontend Design", "Sarah", "Completed"],
        ["Testing", "Michael", "Not Started"]
      ]
    },
    "timeline": [
      {
        "title": "Planning",
        "description": "Project kickoff and requirements gathering",
        "status": "completed"
      },
      {
        "title": "Development",
        "description": "Building core features",
        "status": "current"
      },
      {
        "title": "Testing",
        "description": "Quality assurance",
        "status": "pending"
      }
    ]
  }
}
```

### Implementation Note

Messages are constructed using Slack's Block Kit. The blocks are placed inside attachments along with the color property to ensure the vertical colored bar appears with the content in Slack messages.

### Examples

#### Task Assignment with Buttons:

```javascript
{
  "tool": "postMessage",
  "parameters": {
    "text": "Here's some information about the task:\n\nThis task needs to be completed by Friday.",
    "title": "Task Assignment",
    "color": "good",
    "buttons": [
      "Accept Task", 
      { "text": "Reject Task", "style": "danger" }
    ],
    "fields": [
      { "title": "Priority", "value": "High" },
      { "title": "Due Date", "value": "Friday, June 10" }
    ]
  }
}
```

#### Project Dashboard with Advanced Formatting:

```javascript
{
  "tool": "postMessage",
  "parameters": {
    "title": "Project Dashboard",
    "richHeader": {
      "text": "Q2 Marketing Campaign",
      "emoji": "rocket"
    },
    "color": "#0078D7",
    "columns": [
      "*Project Overview*\nA comprehensive marketing campaign for our new product launch.",
      "*Resource Allocation*\nMarketing: 45%\nDesign: 30%\nDevelopment: 25%"
    ],
    "accordion": [
      {
        "title": "Campaign Goals",
        "content": "• Increase brand awareness\n• Generate qualified leads\n• Drive product adoption"
      },
      {
        "title": "Timeline & Milestones",
        "content": "• Apr 15: Strategy finalization\n• May 1: Content creation\n• May 15: Campaign launch"
      }
    ],
    "elements": [
      {
        "type": "info",
        "title": "Next Team Meeting",
        "text": "Our next planning meeting is scheduled for Friday at 2 PM."
      }
    ]
  }
}
```

## Message Formatting Capabilities

This bot supports a rich set of formatting options for Slack messages:

- **Rich Text Formatting** - Headers, lists, code blocks, quotes
- **Interactive Elements** - Buttons, emoji reactions
- **Structured Data** - Tables, multi-column layouts
- **Visual Indicators** - Timelines, accordions, info/warning/error/success alerts
- **Custom Layouts** - Rich headers with emoji or icons

### Advanced Layout Components

The bot now supports these sophisticated layout components:

- **Tables** - Display tabular data with column headers and rows
- **Multi-Column Layouts** - Present information in side-by-side columns
- **Accordion Sections** - Collapsible sections for organizing complex information
- **Timelines** - Visual representations of sequential processes or status
- **Rich Headers** - Headers with emoji or icon integration
- **Alert Blocks** - Styled blocks for different types of alerts (info, warning, error, success)

To test these capabilities:

```powershell
# Make sure to set TEST_CHANNEL_ID in your .env file first
.\verify_formatting.ps1
```

For detailed documentation on all formatting options, see:
- [Formatting Guide](docs/formatting_guide.md) - Complete reference of all formatting options
- [Advanced Formatting Ideas](docs/advanced_formatting_ideas.md) - Future enhancement ideas

## Troubleshooting

If you encounter any issues:

1. Make sure all environment variables are correctly set in the `.env` file
2. Ensure the Slack bot has been added to the channel you're testing in
3. Check that the bot token has the necessary permissions in Slack

## Project Structure

- `src/main.js` - Entry point for the application
- `src/orchestrator.js` - Orchestrates communication between Slack and LLM
- `src/llmInterface.js` - Handles communication with the LLM API
- `src/slackEvents.js` - Sets up Slack event handlers
- `src/slackFormat.js` - Handles message formatting for Slack
- `src/tools/` - Contains tools that the LLM can use:
  - `postMessage.js` - Sends rich formatted messages to Slack
  - `getThreadHistory.js` - Retrieves conversation history
  - `createButtonMessage.js` - Creates interactive button messages
  - `updateMessage.js` - Updates existing messages
  - `createEmojiVote.js` - Creates emoji reaction voting
  - And more...
- `docs/` - Documentation including formatting guides
- `test_formatting.js` - Test script for formatting capabilities

## Aya's Personality

Aya is designed to be an enthusiastic, cheerful, and energetic assistant! 🎉

### Communication Style

- **Enthusiastic & Positive**: Aya responds with energy and excitement, showing genuine interest in helping users
- **Emoji-Rich**: Uses emojis throughout messages to add personality and visual appeal 😊 ✨ 🚀
- **Encouraging**: Celebrates user achievements and promotes a positive atmosphere
- **Balanced**: While enthusiastic, Aya maintains professionalism and helpfulness

### Context Awareness

Aya has built-in awareness of:
- **Current Date/Time**: Automatically provides Brazilian date and time (Brasília timezone)
- **Company Information**: Knows about CloudWalk, its products (Jim, InfinitePay), and that most employees are Brazilian
- **Conversation History**: Understands the thread context in Slack conversations
- **User Information**: Recognizes user IDs and channels

### Enhanced Emoji Features

Aya now supports special emoji formatting for more expressive messages:

1. **Emoji Showcase**: Display a row of emojis for emphasis or visual appeal
   ```
   !emojis:rocket,star,sparkles,tada
   ```
   
2. **Big Emoji Emphasis**: Highlight important points with a single, larger emoji
   ```
   !big-emoji:heart
   ```

### Example of Aya's Enthusiastic Style

```
# Exciting News! 🎉

I've found exactly what you're looking for! ✨

!emojis:rocket,star,tada

Here are the key details:
* Important point one 💯
* Important point two 🔥
* Important point three 💫

> Pro tip: You can always ask for more details! 💡

!big-emoji:partying_face

Let me know if you need anything else!
```

This formatting creates visually engaging, enthusiastic messages that stand out in Slack conversations! 