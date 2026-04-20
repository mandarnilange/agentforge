# Pi Coding Agent: Programmatic Extensions & Tools

This guide explains how to add custom functionality (extensions and tools) to the Pi Coding Agent backend programmatically before calling `agent.run()`.

## Core Concepts

The `@mariozechner/pi-coding-agent` SDK provides two primary ways to extend an agent's capabilities:

1.  **Custom Tools**: Direct addition of LLM-callable functions (e.g., `read_file`, `bash`).
2.  **Extensions**: Full TypeScript modules that can subscribe to lifecycle events (`turn_start`, `message_end`), register commands, and inject context.

---

## 1. Adding Custom Tools (Simple Approach)

If your extension is a stateless capability (like querying a specific database or calling an API), you can define a `ToolDefinition` and add it to the agent's initial state.

```typescript
import { Agent } from "@mariozechner/pi-agent-core";
import { defineTool, createCodingTools } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// 1. Define your custom tool with a schema
const myCustomTool = defineTool({
  name: "query_database",
  description: "Queries the production database for user analytics",
  parameters: Type.Object({
    query: Type.String({ description: "The SQL query to execute" })
  }),
  async execute(id, { query }) {
    // Implement your logic here
    const data = await db.execute(query);
    return { 
      content: [{ type: "text", text: JSON.stringify(data) }],
      details: { rowCount: data.length } 
    };
  }
});

// 2. Combine with default coding tools (read, write, edit, bash, etc.)
const tools = [
  ...createCodingTools(process.cwd()),
  myCustomTool
];

// 3. Initialize the agent with these tools
const agent = new Agent({
  initialState: {
    systemPrompt: "You are an analytics assistant...",
    model,
    tools,
    messages: []
  }
});

// 4. Run the agent
await agent.run("What is the user growth for March?");
```

---

## 2. Using the Extension System (Advanced)

For complex integrations that require event listeners (e.g., logging every turn to an external system) or injecting messages before a turn, use the `ExtensionFactory`.

```typescript
import { 
  loadExtensionFromFactory, 
  createExtensionRuntime, 
  ExtensionRunner 
} from "@mariozechner/pi-coding-agent";

// 1. Define an inline extension factory
const myExtensionFactory = (pi: ExtensionAPI) => {
  // Listen to lifecycle events
  pi.on("turn_start", (event, ctx) => {
    console.log(`Starting turn ${event.turnIndex}`);
  });

  // Register tools within the extension
  pi.registerTool(myCustomTool);
};

// 2. Load the extension programmatically
const runtime = createExtensionRuntime();
const extension = await loadExtensionFromFactory(
  myExtensionFactory, 
  process.cwd(), 
  eventBus, 
  runtime
);

// 3. Apply extension tools to your agent instance
agent.state.tools = [
  ...agent.state.tools,
  ...Array.from(extension.tools.values()).map(t => t.definition)
];

// 4. Wire events using the ExtensionRunner (if needed)
const runner = new ExtensionRunner(
  [extension], 
  runtime, 
  process.cwd(), 
  sessionManager, 
  modelRegistry
);

agent.subscribe(async (event) => {
  // Map AgentEvent to ExtensionEvent and emit via the runner
  // This allows the extension's pi.on() handlers to fire
  await runner.emit(event);
});
```

---

## 3. Integration in `automated-ai-development`

To enable this in the current project architecture, you can modify `PiCodingAgentExecutionBackend.ts` to support an `extensions` property in the `AgentRunRequest`.

### Recommended Schema Change (`packages/core/src/definitions/parser.ts`)
Ensure the `extensions` field is parsed from the agent YAML:

```yaml
spec:
  executor: pi-coding-agent
  extensions:
    - my-custom-extension-path
```

### Backend Implementation (`packages/core/src/adapters/execution/pi-coding-agent-backend.ts`)

```typescript
async runAgent(request: AgentRunRequest): Promise<AgentRunResult> {
    // ... load model ...
    
    // 1. Start with base tools
    let tools = this.workdir ? createCodingTools(this.workdir) : [];
    
    // 2. Programmatically load requested extensions
    if (request.extensions && request.extensions.length > 0) {
        const { extensions, runtime } = await loadExtensions(
            request.extensions, 
            this.workdir
        );
        
        // Merge tools from all loaded extensions
        const extensionTools = extensions.flatMap(e => 
            Array.from(e.tools.values()).map(t => t.definition)
        );
        tools = [...tools, ...extensionTools];
    }

    // 3. Create Agent with merged toolset
    const agent = new Agent({
        initialState: {
            systemPrompt: request.systemPrompt,
            model,
            tools,
            messages: [],
        },
        // ...
    });
    
    // ... run agent ...
}
```

## Summary of APIs

| API | Purpose |
|-----|---------|
| `defineTool()` | Type-safe wrapper for creating individual tools. |
| `createCodingTools(dir)` | Returns the standard set of file and shell tools. |
| `loadExtensionFromFactory()` | Loads an extension defined in your current TS/JS file. |
| `loadExtensions(paths, dir)` | Loads external extension files (e.g., from `node_modules` or `.pi/extensions`). |
| `ExtensionAPI` (`pi.*`) | The object passed to extensions to register tools, handlers, and commands. |
