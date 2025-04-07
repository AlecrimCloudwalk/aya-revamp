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