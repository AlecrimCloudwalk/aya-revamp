# ⚠️ LLM-Driven Architecture: Critical Guidelines ⚠️

## Core Principles

### 1. The LLM as Central Decision-Maker

The most important principle in our architecture is that the LLM is the central decision-maker with **full agency** over all aspects of user interaction. This is not just a design preference—it's a fundamental requirement for the system to function as intended.

### 2. ⚠️ CRITICAL: NO HARDCODED RESPONSES TO SLACK ⚠️

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

### 3. ⚠️ MESSAGE PROCESSING RULES ⚠️

The bot should follow these specific rules for when to process and respond to messages:

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

4. **Skip Logging**:
   - All skipped messages should be logged normally with appropriate reason
   - Do not throw errors for skipped messages
   - Include channel type in the log entry

These rules must be implemented at the application level, not in the LLM's decision-making process.

## Implementation Guidelines

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