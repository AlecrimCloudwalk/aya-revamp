# ⚠️ LLM-Driven Architecture: Core Principles ⚠️

## Fundamental Principles

### The LLM as Central Decision-Maker

The most important principle in our architecture is that the LLM is the central decision-maker with **full agency** over all aspects of user interaction. This is not just a design preference—it's a fundamental requirement for the system to function as intended.

All user-intent decisions must be made by the LLM, not by code:
- No code should interpret user intent
- No code should route requests based on keywords
- No code should decide which tool to call

### STRICTLY FORBIDDEN Patterns

- Pattern matching, regex filters, or hard-coded logic paths that decide:
  - Which tools to use
  - When to respond to a user
  - How to interpret user requests
  - Whether to chain multiple tools
  - What clarification questions to ask
  - Any form of content filtering or routing based on keywords

### ⚠️ CRITICAL: NO HARDCODED RESPONSES TO SLACK ⚠️

**NEVER ADD HARDCODED RESPONSES DIRECTLY TO SLACK.** All responses must be generated dynamically by the LLM based on context. Hardcoding responses undermines the entire architecture and creates inconsistent user experiences.

❌ **BAD:**
```javascript
// DO NOT DO THIS
if (error) {
  await slack.chat.postMessage({
    channel: channelId,
    text: "I'm sorry, I encountered an error. Please try again."
  });
}
```

✅ **GOOD:**
```javascript
// DO THIS INSTEAD
if (error) {
  await handleErrorWithLLM(error, slackContext);
}
```

## Implementation Guidelines

### Message Processing Rules

The bot follows these specific rules for when to process and respond to messages:

1. **Development Mode**:
   - When in development mode, ONLY respond to messages containing the special key `!@#`
   - All other messages should be skipped in development mode
   - Log skipped messages with the reason "Dev mode - missing special key !@#"

2. **Direct Messages (DMs)**:
   - In 1:1 DMs, respond directly to all messages
   - No special key or mention required

3. **Channels and Group Messages**:
   - ONLY respond when specifically mentioned (@bot-name)
   - All other channel messages should be skipped
   - Log skipped messages with the reason "Channel message - no app mention"

### Error Handling

1. **All errors must be routed through the LLM**
   - Use the `handleErrorWithLLM` function in `src/errors.js`
   - Provide full context to the LLM for informed decisions
   - Let the LLM decide how to respond to the user

2. **No direct response generation in code**
   - Error messages should never be hardcoded
   - Response formatting should be determined by the LLM
   - Tone and style should be consistent with the bot's persona

### Message Flow Control

1. **No code-based intent parsing**
   - No regex or pattern matching to determine response paths
   - No keyword-based routing of requests
   - No hardcoded decision trees

2. **No code-based content filtering**
   - No blocking or modifying LLM outputs in code
   - No forced message templates
   - No bot personality changes based on keywords

## Key Requirements

### Tool Management
- Simple tool registration system
- Easy to add new tools without modifying core code
- Consistent interface for tool definitions

### Error Handling
- LLM should be responsible for error recovery decisions
- Pass error context and retry counts to the LLM
- Let the LLM decide retry strategy based on context

### Asynchronous Processing
- Support for long-running operations
- Ability to handle slow external APIs
- Simple pattern for async operations without overcomplicating

### Interactive Features
- Support for interactive buttons in messages
- Context preservation when handling button clicks
- Clean integration with LLM decision-making

### Rich Message Formatting
- Simple, intuitive methods for the LLM to build Slack Block Kit messages
- Functions should be as simple as `addDivider()`, `addHeader()`, etc.
- ALL messages MUST have a vertical colored Slack Block Kit bar (non-negotiable)
- LLM can select the color from predefined options

## Maintaining This Approach

1. **Code reviews must check for these issues**
   - New PRs should be checked for hardcoded responses
   - New error handlers must route through the LLM
   - New message handlers must not circumvent the LLM

2. **Refactoring existing code**
   - Identify and fix existing hardcoded responses
   - Convert direct Slack messages to LLM-driven responses
   - Remove any keyword-based routing or special modes

## Why This Matters

Hardcoded responses and persona modifications:

1. Create inconsistent user experiences
2. Make maintenance more difficult
3. Limit the bot's ability to adapt to context
4. Create confusing and brittle code paths
5. Undermine the core value of an LLM-based system 