# Thread Context Building System

## Overview

The Thread Context Builder is a dedicated system for providing clear, consistent, and accurate context to the LLM when interacting with Slack threads. This document explains how the new system works, its advantages, and how it interacts with the rest of the application.

## Core Principles

1. **Single Source of Truth**: Thread history fetched directly from Slack API provides the foundation for all context.
2. **Consistent Format**: All context follows the exact format specified in `docs/llm_context_format.md`.
3. **Proper Turn Tracking**: Messages are organized chronologically with proper turn counting for better conversation flow.
4. **Simplified Architecture**: Replaces complex context accumulation with a direct fetch-and-format approach.
5. **Resilient Caching**: Efficient caching with force refresh capability to balance performance and accuracy.

## Components

### ThreadContextBuilder Class

The main implementation in `src/threadContextBuilder.js` provides:

- `buildContext(threadTs, channelId)`: Builds complete context array following the specified format
- `clearCache(threadTs, channelId)`: Clears cached thread history when needed
- Thread info detection (DM vs Thread)
- Role detection (user, assistant, system)
- Tool call extraction from messages
- Thread message formatting

### Integration Points

1. **LLM Interface**: `src/llmInterface.js` uses the ThreadContextBuilder to get context for OpenAI calls.
2. **Orchestrator**: `src/orchestrator.js` integrates with ThreadContextBuilder for processing threads.
3. **Tools**: `src/tools/getThreadHistory.js` uses ThreadContextBuilder to fetch thread history.

## Context Format

The context follows this structure:

```json
[
  {
    "index": 0,
    "turn": 0,
    "timestamp": "2023-04-04T12:33:00Z",
    "role": "system",
    "content": "You're a helpful AI assistant..."
  },
  {
    "index": 1,
    "turn": 0,
    "timestamp": "2023-04-04T12:33:00Z",
    "role": "system",
    "content": "Thread information: This is a thread with 5 messages..."
  },
  {
    "index": 2,
    "turn": 0,
    "timestamp": "2023-04-04T12:33:10Z",
    "role": "user",
    "content": {
      "userid": "<@U1234546>",
      "text": "Hello, can you help me?"
    }
  },
  {
    "index": 3,
    "turn": 0,
    "timestamp": "2023-04-04T12:33:20Z",
    "role": "assistant",
    "content": {
      "toolCall": "getThreadHistory",
      "text": "I'll check the thread history",
      "reasoning": "Need to get context for the conversation"
    }
  }
]
```

## Advantages Over Previous Approach

1. **Reliability**: Uses direct Slack API calls rather than accumulated state.
2. **Readability**: Consistent format makes it easier for the LLM to understand context.
3. **Maintainability**: Simplified architecture is easier to debug and extend.
4. **Performance**: Efficient caching reduces API calls while allowing fresh data when needed.
5. **Resilience**: Better error handling and fallback mechanisms.

## Usage

To use the ThreadContextBuilder:

```javascript
const { getThreadContextBuilder } = require('./threadContextBuilder.js');

async function example() {
  const threadContextBuilder = getThreadContextBuilder();
  const context = await threadContextBuilder.buildContext(threadTs, channelId);
  
  // Use context with LLM
  // ...
}
```

## Implementation Details

1. The ThreadContextBuilder fetches thread messages from Slack in chronological order.
2. Messages are analyzed to determine roles (user, assistant, system).
3. Assistant messages are examined for potential tool calls.
4. Turns are tracked by detecting role changes (user → assistant → user constitutes a turn).
5. The context array is built following the specified format.
6. Thread info is added as a system message for better context.

## Future Improvements

1. Enhanced tool call detection from message content.
2. Better handling of complex message formats (blocks, attachments, etc.).
3. User information enrichment for better personalization.
4. Thread summarization for very long threads. 