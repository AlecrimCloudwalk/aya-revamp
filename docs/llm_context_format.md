# LLM Context Format

## Overview

This document specifies the format for conversation context provided to the LLM. Following this format consistently is critical for optimal LLM performance.

## Data Structure

Each conversation is represented as a JSON array of message objects with the following structure:

```json
{
  "index": 0,
  "turn": 0,
  "timestamp": "2023-04-04T12:33:00Z",
  "role": "system|user|assistant",
  "content": string|object
}
```

### Role-specific Content Format

#### System Message
```json
"content": "You're a helpful AI assistant named Aya..."
```

#### User Message
```json
"content": {
  "userid": "<@U1234546>",
  "text": "Can you suggest lunch options?"
}
```

#### Assistant Message
```json
"content": {
  "toolCall": "postMessage",
  "text": "Here are some lunch suggestions...",
  "reasoning": "Providing lunch options as requested"
}
```

## Console Display Format

For debugging, the message flow is displayed as:

```
🧠 System: [system message content]

👤 User <@userid> [Turn X]
🕐 [timestamp]
> [user message]

🤖 Assistant [Turn X]
🕐 [timestamp]
🔧 [toolCall] (parameter: value)
   └─ Reason: [reasoning]
```

## Tool Call Emojis

- 🔧 `getThreadHistory` and general tools
- 💬 `postMessage` 
- ✅ `finishRequest`

## Complete Example

### JSON Format
```json
[
  {
    "index": 0,
    "turn": 0,
    "timestamp": "2023-04-04T12:33:00Z",
    "role": "system",
    "content": "You're a helpful AI assistant named Aya. You help users with content..."
  },
  {
    "index": 1,
    "turn": 0,
    "timestamp": "2023-04-04T12:33:10Z",
    "role": "user",
    "content": {
      "userid": "<@U1234546>",
      "text": "Suggest lunch options please."
    }
  },
  {
    "index": 2,
    "turn": 1,
    "timestamp": "2023-04-04T12:33:20Z",
    "role": "assistant",
    "content": {
      "toolCall": "getThreadHistory",
      "ascending": false,
      "reasoning": "Checking for context about dietary preferences"
    }
  },
  {
    "index": 3,
    "turn": 1,
    "timestamp": "2023-04-04T12:33:30Z",
    "role": "assistant",
    "content": {
      "toolCall": "postMessage",
      "text": "Here are some lunch suggestions: 1) Mushroom risotto, 2) Caesar salad, 3) Vegetable curry",
      "reasoning": "Providing diverse lunch options"
    }
  }
]
```

### Console Display
```
🧠 System: You're a helpful AI assistant named Aya...

👤 User <@U1234546> [Turn 0]
🕐 2023-04-04T12:33:10Z
> Suggest lunch options please.

🤖 Assistant [Turn 1]
🕐 2023-04-04T12:33:20Z
🔧 getThreadHistory (ascending: false)
   └─ Reason: Checking for context about dietary preferences

🤖 Assistant [Turn 1]
🕐 2023-04-04T12:33:30Z
💬 postMessage:
   "Here are some lunch suggestions: 1) Mushroom risotto, 2) Caesar salad, 3) Vegetable curry"
   └─ Reason: Providing diverse lunch options
```

## Implementation Requirements

1. Messages must be in chronological order by index
2. Each entry must include all required fields
3. The `turn` field must correctly track conversation turns
4. System messages should appear at strategic points
5. Only use roles: "system", "user", "assistant"
6. Use ISO 8601 timestamps throughout
7. All tool calls must include reasoning when possible 