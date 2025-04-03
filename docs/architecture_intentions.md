# Slack Bot Architectural Intentions

## Core Principles

- **LLM-Driven Architecture**: The LLM must be the central decision-maker with full agency over all aspects of user interaction
- **No Hardcoded Responses**: All responses to users must be generated dynamically by the LLM, never hardcoded in the application
- **Consistent Persona**: The bot must maintain its defined assistant role and never assume alternate personas based on special triggers
- **Simplicity Over Complexity**: Prefer simple solutions that are easy to maintain
- **Kubernetes-Native**: Design with Kubernetes deployment in mind
- **Modular Tool System**: Enable easy addition of new tools without modifying core code

## Deployment Context

- Existing CI/CD pipeline with Git Actions, Kubernetes, and ArgoCD
- Bot will be updated by pushing new versions to the original repository
- Expected load: Maximum 5 concurrent requests
- Some tools will require longer processing times (e.g., video encoding, external API calls)

## Key Requirements

1. **Tool Management**
   - Simple tool registration system
   - Easy to add new tools without modifying core code
   - Consistent interface for tool definitions

2. **Error Handling**
   - LLM should be responsible for error recovery decisions
   - Pass error context and retry counts to the LLM
   - Let the LLM decide retry strategy based on context

3. **Asynchronous Processing**
   - Support for long-running operations
   - Ability to handle slow external APIs
   - Simple pattern for async operations without overcomplicating

4. **Interactive Features**
   - Support for interactive buttons in messages
   - Context preservation when handling button clicks
   - Clean integration with LLM decision-making

5. **Logging**
   - Minimal but effective logging system
   - Human-readable format primarily for development testing
   - Focus on entry points, tool selections, and errors

6. **Rich Message Formatting**
   - Simple, intuitive methods for the LLM to build Slack Block Kit messages
   - Functions should be as simple as `addDivider()`, `addHeader()`, etc.
   - ALL messages MUST have a vertical colored Slack Block Kit bar (non-negotiable)
   - LLM can select the color from predefined options
   - Support for templates that the LLM can adapt for different request types
   - Formatting functions will use a self-registration pattern similar to tools
   - Each formatting function will provide metadata (name, description, parameters, examples)
   - Pre-defined message templates will be available for common scenarios (errors, confirmations, etc.)
   
7. **Message Tone Filtering**
   - Add filtering step in the postMessage tool to modify tone
   - Enable transformation of messages to different speech styles (fun with emojis, pirate speak, etc.)
   - Allow control of bot's tone without changing core functionality
   - Keep tone transformation separate from message content generation

## Non-Goals

- Complex structured logging system
- Heavy caching infrastructure
- Unnecessary abstraction layers
- Over-engineering for scale beyond requirements

## Development Approach

- Develop and test in a private Slack channel
- Push to production once features are validated
- Minimize maintenance burden
- Focus on reliability and correctness 