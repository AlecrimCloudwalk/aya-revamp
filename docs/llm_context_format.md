# LLM Context Format Specification

## Overview

This document specifies the exact format for the conversation context that should be provided to the LLM on each prompt. Following this format consistently is critical for optimal LLM performance and reasoning.

## JSON Data Structure

Each conversation is represented as a JSON array of message objects. Each message object has the following structure:

```json
{
  "index": 0,
  "turn": 0,
  "timestamp": "2025-04-04T12:33:00Z",
  "role": "system|user|assistant",
  "content": string|object
}
```

Where:
- `index`: Sequential number, starting from 0
- `turn`: Conversation turn number
- `timestamp`: ISO 8601 format timestamp
- `role`: One of "system", "user", or "assistant"
- `content`: Either a string (for system messages) or an object (for user and assistant messages)

## Role-specific Content Format

### System Message Content
Plain string containing instructions or guidance:
```json
"content": "You're a helpful AI assistant named Aya. You help users with content..."
```

### User Message Content
Object with user ID and message text:
```json
"content": {
  "userid": "<@1234546>",
  "text": "Oi, me dê uma sugestão de almoço por favor."
}
```

### Assistant Message Content
Object containing tool call information:
```json
"content": {
  "toolCall": "postMessage",
  "text": "Message content here",
  "reasoning": "Reason for the tool call"
}
```

## Console Logging Format

For debugging and visualization, the JSON data should be formatted in console logs as follows:

```
🧠 System: [system message content]

👤 User <@userid> [Turn X]
🕐 [timestamp]
> [user message]

🤖 Assistant [Turn X]
🕐 [timestamp]
🔧 [toolCall] (parameter: value)
   └─ Reason: [reasoning]

🤖 Assistant [Turn X]
🕐 [timestamp]
💬 postMessage:
   "[message text]"
   └─ Reason: [reasoning]

🤖 Assistant [Turn X]
🕐 [timestamp]
✅ finishRequest
   └─ Reason: [reasoning]
```

## Tool Call Emojis

Different tool calls use specific emojis in console logs:
- 🔧 `getThreadHistory` and general tools
- 💬 `postMessage` 
- ✅ `finishRequest`

## Complete Example

### JSON Format
```json
[
  {
    "index": 0,
    "turn": "0",
    "timestamp": "2025-04-04T12:33:00Z",
    "role": "system",
    "content": "You're a helpful AI assistant named Aya. You help users with content..."
  },
  {
    "index": 1,
    "turn": 0,
    "timestamp": "2025-04-04T12:33:00Z",
    "role": "user",
    "content": {
      "userid": "<@1234546>",
      "text": "Oi, me dê uma sugestão de almoço por favor."
    }
  },
  {
    "index": 2,
    "turn": 1,
    "timestamp": "2025-04-04T12:34:00Z",
    "role": "assistant",
    "content": {
      "toolCall": "getThreadHistory",
      "ascending": false,
      "reasoning": "Checking the thread history for more context"
    }
  },
  {
    "index": 3,
    "turn": 1,
    "timestamp": "2025-04-04T12:35:00Z",
    "role": "assistant",
    "content": {
      "toolCall": "postMessage",
      "text": "Claro, vou te ajudar com isso! Que tal um delicioso risoto de cogumelos?",
      "reasoning": "Suggesting a lunch option to the user"
    }
  }
]
```

### Console Log Visualization
```
🧠 System: You're a helpful AI assistant named Aya. You help users with content...

👤 User <@1234546> [Turn 0]
🕐 2025-04-04T12:33:00Z
> Oi, me dê uma sugestão de almoço por favor.

🤖 Assistant [Turn 1]
🕐 2025-04-04T12:34:00Z
🔧 getThreadHistory (ascending: false)
   └─ Reason: Checking the thread history for more context

🤖 Assistant [Turn 1]
🕐 2025-04-04T12:35:00Z
💬 postMessage:
   "Claro, vou te ajudar com isso! Que tal um delicioso risoto de cogumelos?"
   └─ Reason: Suggesting a lunch option to the user
```

## Implementation Requirements

1. All messages must be presented in strict chronological order by index
2. Each entry must include all required fields (index, turn, timestamp, role, content)
3. The `turn` field must correctly track conversation turns
4. System messages should appear at strategic points (beginning, after significant interactions)
5. Only use the specified roles: "system", "user", "assistant"
6. Object structures must follow the exact format shown above
7. ISO 8601 timestamps must be used throughout

## Important Notes

- Ensure all tool calls include the reasoning component when possible
- System messages should be concise and directive
- This format replaces any previous context formatting approach
- The LLM should receive this exact JSON structure with each prompt 