# Slack Bot Aya - LLM-Driven Bot

## Overview

This is an LLM-driven Slack bot that uses the OpenAI API to communicate with users in Slack. The bot is designed to be completely driven by the LLM, with no hard-coded decision-making logic for user interactions.

## Key Features

- Fully LLM-driven architecture - all decisions are made by the LLM
- Integrated debugging tools for easy troubleshooting
- Thread-based conversation management
- Modular tool system for extending functionality

## Quick Start

1. Install dependencies:
   ```
   npm install
   ```

2. Set up environment variables in a `.env` file:
   ```
   SLACK_BOT_TOKEN=your_slack_bot_token
   SLACK_SIGNING_SECRET=your_slack_signing_secret
   SLACK_APP_TOKEN=your_slack_app_token
   LLM_API_KEY=your_openai_api_key
   LLM_MODEL=gpt-3.5-turbo
   ```

3. Start the bot:
   ```
   npm start
   ```

## Debug Mode

For easy debugging, we've built in a special debug mode that provides clear visibility into exactly what is being sent to and received from the LLM:

```bash
# Basic debugging
npm run debug

# Verbose debugging with more details
npm run debug:verbose

# Save all LLM interactions to log files
npm run debug:file

# Maximum debugging (verbose + file logging + raw message content)
npm run debug:all
```

Debug mode provides:
- Tabular view of all messages sent to the LLM
- Clear display of tool calls and parameters
- Token usage statistics
- Complete thread context visualization

See `docs/LLM_DEBUGGING.md` for detailed information on the debugging capabilities.

## Architecture

This bot follows a strict LLM-first architecture:

1. **LLM as the Central Decision Maker**
   - The LLM decides which tools to use, when to respond, and how to interpret user requests
   - No pattern matching or keyword routing in code

2. **Thread-Centric Design**
   - All state management is thread-based
   - Thread history is preserved for context

3. **Modular Tool System**
   - Each capability is implemented as a "tool" the LLM can call
   - Tools are in separate files under `src/tools/`

## Tools

The bot includes several tools that the LLM can use:

- `postMessage`: Post messages to Slack
- `getThreadHistory`: Get conversation history
- `finishRequest`: Signal end of processing
- `addReaction`: Add emoji reactions to messages
- `updateMessage`: Edit previously sent messages

## Development

### Adding New Tools

1. Create a new file in `src/tools/`
2. Implement the tool function
3. Register it in `src/tools/index.js`
4. The LLM will automatically have access to the new tool

### Logging & Debugging

See `docs/LLM_DEBUGGING.md` for detailed information on the debugging capabilities.

## License

MIT

## Security

### Gitleaks Secret Scanner

This project uses Gitleaks to prevent accidental secret leakage in Git repositories:

- **Pre-commit Hook**: Automatically scans all staged changes before each commit
- **Local Installation**: Gitleaks is stored in the `.tools` directory
- **Configuration**: The pre-commit hook is configured in `.git/hooks/pre-commit` and `.git/hooks/pre-commit.ps1`

#### For New Developers

After cloning the repository, ensure the pre-commit hook is executable:

```powershell
icacls ".git\hooks\pre-commit" /grant Everyone:F
```

See `docs/gitleaks-setup.md` for more details on the Gitleaks implementation.

## System Prompt Organization

The system prompts for the LLM are centralized in a single module to avoid duplication and inconsistency:

### Key Files

- **`src/prompts/aya.js`**: The central location for all system prompt content. This module includes:
  - Personality configuration 
  - Complete system prompt text (previously in system_prompt_updated.md)
  - Technical guidelines for tool calls
  - Emoji reaction guidelines
  - Formatting guidelines
  - Tool call examples

### Exports and Functions

The aya.js module exports several constants and functions:

```javascript
// Constants
PERSONALITY                // Basic personality config
TECHNICAL_GUIDELINES       // Technical formatting requirements
PERSONALITY_TRAITS         // Personality traits for the chatbot
EMOJI_REACTION_GUIDELINES  // Guidelines for emoji reactions
CUSTOM_EMOJIS              // List of custom workspace emojis
FORMATTING_GUIDELINES      // Formatting guidelines for messages
TOOL_CALL_EXAMPLES         // Example tool calls
COMPLETE_SYSTEM_PROMPT     // The entire system prompt content

// Functions
generatePersonalityPrompt()  // Creates the main personality prompt
getCompleteSystemPrompt()    // Gets the full system prompt
generateTechnicalAppendix()  // Creates the technical appendix
getFormattedEmojiList()      // Formats the list of custom emojis
```

### Usage

The centralized prompts are used in two main places:

1. **`src/llmInterface.js`**: Uses the system prompt and technical guidelines for API calls
2. **`src/contextBuilder.js`**: Uses the personality prompt for message context

## Future Changes to System Prompts

When making changes to the system prompts:

1. **DO NOT** modify inline prompts in contextBuilder.js or llmInterface.js
2. **DO** update the appropriate section in `src/prompts/aya.js`
3. Any feature-specific content should be organized into logical sections in aya.js
4. For extensive changes to the main system prompt, modify the `COMPLETE_SYSTEM_PROMPT` constant

This monolithic structure helps maintain consistency across the application and prevents duplicate or conflicting prompt content. 