"use server";

import { openai } from "@ai-sdk/openai";
import { wrapAISDKModel } from "langsmith/wrappers/vercel";
import { generateText, experimental_createMCPClient, type StepResult } from "ai";
import { AgentContext } from "@/lib/types";
import { jwtDecode } from "jwt-decode";
import { OpenAPIToTools } from "./toolConverterUtils";
// import { exportToPdfTool } from "@/lib/exportToPDFTool";
import {
  connectMcpServerTool,
  convertOpenApiSpecToAgentTool,
} from "@/lib/skyfireTools";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { isJWT } from "@/lib/utils";
import { checkDailyRunLimit, incrementDailyRunCounter, checkRedisConnection } from "../lib/redis";

const vercelModel = openai("gpt-4o", { structuredOutputs: true });
const modelWithTracing = wrapAISDKModel(vercelModel);

interface FormattedStep {
  step: number;
  text: string;
  tool: string;
  input: unknown;
  result: unknown;
}

interface ToolCall {
    type: string;
    toolCallId: string;
    toolName: string;
    args: {
      [key: string]: string;
    }
}

interface ToolResult {
    result: {
        content: Array<{ type: string; text: string }>;
    }
}

// Use the SDK's types directly - use any to handle dynamic tools
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AIStep = StepResult<any>;

const systemPrompt: string = `
<setup>
You are connected to tools from MCP servers and hosted OpenAPI specs (jsons)
and are solving problems step by step. To use an OpenAPI spec can do and convert it to a tool, use the convertOpenApiSpecToAgentTool tool.
Make sure to inlcude the openapi.json at the end of urls
</setup>

<procedures>
Remember to use only the create-kya-pay-token tool from skyfire before using an external service tool call
</procedures>

 MCP servers have /mcp or /sse at the end, if it's a json then you would connect via the OpenAPI tool.
<terminate>
When connect-mcp-server-tool tool is executed, stop the processing immediately.
You can execute multiple convert-openapi-spec-to-agent-tool calls in sequence, but after all OpenAPI conversions are complete, stop processing.
</terminate>

Make sure to create and pass a token with proper balance before using external services. You may need to re create tokens as you call services again.

Pass in headers skyfire_kya_pay_token with value as the pay token for openapi tool calls.
`;

const textConfig: {[key:string]: string} = {
  "find-seller":
    "I will use Skyfire's mcp server resources resources/list to find the Buildship seller for the requested data & retrieve the OpenAPI server URL of the seller",
  "create-kya-token":
    "I will use Skyfire's create-kya-token tool to create a KYA token for myself",
  "create-payment-token":
    "I will use Skyfire's create-payment-token tool to create a PAY token for the service which is later used by receiver to claim payment",
  "create-kya-pay-token":
    "I will use Skyfire's create-kya-pay-token tool to create a KYA+PAY token for the service which is later used by receiver to claim payment",
  "execute_companyresearcher_tool":
    "I will use Buildship's Company Researcher tool to get structured company information.",
  "execute_researchcompetitors_tool":
    "I will use Buildship's Research Competitors tool to generate a structured competitor analysis",
  "export-text-to-pdf":
    "I will export the provided text content to a PDF document with customizable formatting options.",
  "connect-mcp-server-tool": "Installing MCP server",
  "convert-openapi-spec-to-agent-tool": "Converting OpenAPI spec to tools...",
};

export async function getAgent(
  apiKey: string,
  input: string | Record<string, string>,
  agentContext: AgentContext,
) {

  if(!apiKey)
    apiKey = process.env.SKYFIRE_API_KEY || "";

  const TESTING = process.env.TEST_MODE === 'true';
  console.log("TESTING", TESTING, "no rate limiting with Redis");
  // Check Redis connection first
  // COMMENT out if you do not want to rate limit usage
  if (!TESTING) {
    console.log("🔍 Checking Redis connection...");
    const redisStatus = await checkRedisConnection();
    if (!redisStatus.connected) {
      const errorMessage = `Redis connection failed: ${redisStatus.error}. The agent cannot run without Redis. Please check your Redis configuration.`;
      console.log("🚫 " + errorMessage);
      return JSON.stringify({
        error: true,
        message: errorMessage,
        redisError: true,
        steps: [],
        usage: null,
        agentContext,
      }, null, 2);
    }

    // Check daily run limit before proceeding
    console.log("🔍 Checking daily run limit...");
    const dailyCap = parseInt(process.env.DAILY_RUN_CAP || '250', 10);
    const limitResult = await checkDailyRunLimit(dailyCap);
    if (limitResult.limitExceeded) {
      const errorMessage = `Daily run limit exceeded. Maximum ${dailyCap} runs per day allowed. Please try again tomorrow.`;
      console.log("🚫 " + errorMessage);
      return JSON.stringify({
        error: true,
        message: errorMessage,
        dailyCap: dailyCap,
        currentUsage: limitResult.currentUsage,
        steps: [],
        usage: null,
        agentContext,
      }, null, 2);
    }
    
    // Increment daily run counter
    console.log("📈 Incrementing daily run counter...");
    await incrementDailyRunCounter();
  } else {
    console.log("🧪 TEST_MODE enabled - skipping Redis connection check and rate limiting");
  }
  // Always create a fresh agent context for each run
  agentContext = {
    available_mcp_servers: [
      {
        url: process.env.SKYFIRE_MCP_URL || "",
        headers: {
          "skyfire-api-key": apiKey,
        },
      },
      // { url: process.env.VISUALISATION_MCP_URL || "", headers: {} },
    ],
    dynamically_mounted_server: [],
    openApiSpecs: [],
    conversation_history: [
      {
        role: "system",
        content: systemPrompt,
      },
    ],
  };

  const inputObject: Record<string, string> =
    typeof input === "string" ? JSON.parse(input) : input;

  return runAgent(apiKey, inputObject.prompt, agentContext);
}

async function runAgent(
  apiKey: string,
  input: string,
  agentContext: AgentContext,
  initialFormattedSteps: FormattedStep[] = []
) {
  console.log("🚀 STARTING AGENT RUN");
  console.log("📝 INPUT:", input);
  
  // Prepare tools from all the connected MCP servers and OpenAPI specs
  // eslint-disable-next-line prefer-const
  let allTools = await prepareAllTools(agentContext);
  
  console.log("🛠️ AVAILABLE TOOLS:", Object.keys(allTools));
  console.log("🛠️ Openapi Specs:", agentContext.openApiSpecs);
  // add user prompt to agentContext
  agentContext.conversation_history.push({
    role: "user",
    content: input,
  });

  // Run agent by passing all the prepared tools and agentContext
  console.log("🔄 EXECUTING AGENT...");
  const {
    text: answer,
    usage,
    steps,
    response,
  } = await generateText({
    model: modelWithTracing,
    maxTokens: 5000,
    tools: allTools,
    maxSteps: 20,
    messages: agentContext.conversation_history,
  });
  
  console.log("✅ AGENT EXECUTION COMPLETE");
  console.log("📊 USAGE:", usage);
  console.log("📝 FINAL ANSWER:", answer);
  console.log("🔢 TOTAL STEPS:", steps.length);

  // Update agentContext to include all the executed steps
  agentContext.conversation_history.push(...response.messages);

  // Format steps for display
  let formattedSteps: FormattedStep[] = [...initialFormattedSteps];

  console.log("📋 FORMATTING OUTPUT STEPS...");
  formatOutput(steps, formattedSteps);
  console.log("📋 FORMATTED STEPS:", formattedSteps);

  // when MCP server or OpenAPI spec is discovered, newToolsFound is set to True
  const newToolsFound = checkAndUpdateAgentContextIfConnectionIsInitiated(
    steps,
    agentContext
  );

  // If new tools are discovered, RE-RUN the agent
  if (newToolsFound) {
    const modelResponse = JSON.parse(
      await runAgent(apiKey, input, agentContext, formattedSteps)
    );
    formattedSteps = modelResponse.steps;
  }

  // Return final response
  return JSON.stringify(
    {
      answer,
      steps: formattedSteps,
      usage,
      agentContext,
    },
    null,
    2
  );
}

const getDecodedJWT = (toolResult: ToolResult) => {
  const tokenRes: string = toolResult.result.content[0].text;
  const token: string = tokenRes.split(" ")[tokenRes.split(" ").length - 1];
  if (isJWT(token)) {
  const jwtHeader: string = jwtDecode(token, { header: true });
  const jwtPayload: string = jwtDecode(token);

  const jwtDecoded = { header: jwtHeader, payload: jwtPayload };
  return { token: token, jwtDecoded: jwtDecoded, isValidJWT: true };
  } 

  return { token: token, jwtDecoded: {},  isValidJWT: false };
};

const pushFormattedSteps = (formattedSteps: FormattedStep[], token: string, jwtDecoded: { header: string, payload: string}) => {
  return formattedSteps.push({
    step: 1,
    text: "Decoding JWT token...",
    tool: "thinking",
    input: {},
    result: {
      args: { token: token },
      result: { content: jwtDecoded },
    },
  });
};

const getStepDescription = (step: AIStep, toolCall: ToolCall | null) => {
  let text = step.text;
  if (toolCall) {
    text = textConfig[toolCall.toolName] || text;
    if (toolCall.toolName === "get-pricing") {
      text = text + toolCall.args["dataset_id"];
    }
  }
  return text;
};

const prepareAllTools = async (agentContext: AgentContext) => {
  let client;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clients: Record<string, any> = {};

  const allServers = [
    ...agentContext?.available_mcp_servers,
    ...agentContext?.dynamically_mounted_server,
  ];
  let allTools = { 
    ...connectMcpServerTool,
    ...convertOpenApiSpecToAgentTool,
    // ...exportToPdfTool,
  };

  // Process OpenAPI specs first
  for (let j = 0; j < agentContext.openApiSpecs?.length; j++) {
    console.log("openAPiSPecs", agentContext.openApiSpecs);
    const postSpec = await fetch(agentContext.openApiSpecs[j].url);
    console.log("postSpec", postSpec);
    const postSpecResponse = await postSpec.json();

    // Extract operation summaries for tool naming
    const toolNames: Record<string, string> = {};
    if (postSpecResponse.paths) {
      Object.entries(postSpecResponse.paths).forEach(([path, pathItem]) => {
        if (!pathItem || typeof pathItem !== "object") return;
        const methods = ["get", "post", "put", "delete", "patch"];
        methods.forEach((method) => {
          const operation = (pathItem as Record<string, unknown>)[method];
          if (
            operation &&
            typeof operation === "object" &&
            "summary" in operation
          ) {
            const toolKey = `${method}_${path}`;
            toolNames[toolKey] = String(operation.summary)
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "_");
          }
        });
      });
    }

    const converter = new OpenAPIToTools(
      postSpecResponse,
      agentContext.openApiSpecs[j].authHeader || "", // Use authHeader if provided, otherwise empty string
      toolNames
    );
    const openApiTools = converter.generateTools();
    console.log(
      `✅ Processed OpenAPI spec ${j + 1}, generated ${
        Object.keys(openApiTools).length
      } tools`
    );
    allTools = { ...allTools, ...openApiTools };
  }

  // Filter servers to only include MCP servers (URLs ending with /mcp), not JSON OpenAPI specs
  const mcpServers = allServers.filter((server) => {
    const url = server.url;
    const isJsonSpec = url.endsWith(".json");
    const isMcpServer =
      url.endsWith("/mcp") || url.endsWith("/sse") || (!isJsonSpec && !url.includes(".json"));

    if (isJsonSpec) {
      console.log(
        `⚠️  Skipping JSON OpenAPI spec URL (not an MCP server): ${url}`
      );
      return false;
    }

    return isMcpServer;
  });

  console.log(
    "📡 Filtered MCP Servers:",
    mcpServers.map((s) => s.url)
  );

  for (let i: number = 0; i < mcpServers?.length; i++) {
    const localVar = "client" + i;
    client = await experimental_createMCPClient({
      transport: new StreamableHTTPClientTransport(
        new URL(mcpServers[i].url!), 
        {
          requestInit: {
            headers: mcpServers[i].headers
          }
        }
      )
    });

    clients[localVar] = client;

    const toolSet = await client.tools();
    allTools = { ...allTools, ...toolSet };

    try {
      const transport = new SSEClientTransport(
        new URL(mcpServers[i].url), 
        {
          requestInit: {
            headers: mcpServers[i].headers
          }
        }
      );

      const mcpClient = new Client({
        name: "mcp-client",
        version: "1.0.0",
      });

      await mcpClient.connect(transport);

      const resources = await mcpClient.listResources();
      for(let j=0; j<resources.resources.length; j++){
        const resource = await mcpClient.readResource({
          uri: resources.resources[j].uri,
        });

        agentContext.conversation_history.push({
          role: "system",
          content: `${resource.contents[0].text}`,
        });
      }
    }
    catch (err) {
      console.log(`There are no resources available in ${mcpServers[i].url}`);
      console.error(err);
    }
  }

  // Filter out tools with names longer than 64 characters (OpenAI limit)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const validTools: Record<string, any> = {};
  Object.entries(allTools).forEach(([toolName, tool]) => {
    if (toolName.length <= 64) {
      validTools[toolName] = tool;
    } else {
      console.warn(
        `⚠️ Skipping tool "${toolName}" - name too long (${toolName.length} > 64 chars)`
      );
    }
  });

  console.log(
    `🛠️ Valid tools after filtering: ${Object.keys(validTools).length}/${
      Object.keys(allTools).length
    }`
  );

  return validTools;
};

const formatOutput = (steps: AIStep[], formattedSteps: FormattedStep[]) => {
  steps.forEach((step: AIStep) => {
    if (step.toolCalls.length > 0)  {
      for (let i = 0; i < step.toolCalls.length; i++) {
        const toolCall = step.toolCalls[i] as unknown as ToolCall;
        const toolResult = step.toolResults[i] as unknown as ToolResult;
        
        // Print tool outputs to console
        console.log("🔧 TOOL CALL:", {
          toolName: toolCall?.toolName || "unknown",
          args: toolCall?.args || {},
          result: toolResult
        });
        
        // Print detailed tool result content
        if (toolResult?.result?.content) {
          console.log("📤 TOOL OUTPUT CONTENT:");
          toolResult.result.content.forEach((contentItem, index) => {
            console.log(`  Content ${index + 1} (${contentItem.type}):`, contentItem.text);
          });
        }
        
        formattedSteps.push({
          step: 1,
          text: getStepDescription(step, toolCall),
          tool:
            toolCall && toolCall.toolName ? toolCall.toolName : "thinking",
          input: toolCall ? toolCall.args : {},
          result: toolResult,
        });

        if ( 
          toolCall &&
          (toolCall.toolName === "create-payment-token" ||
            toolCall.toolName === "create-kya-token" ||
            toolCall.toolName === "create-kya-pay-token" ||
            toolCall.toolName === "create-account")
        ) {
          try {
          const { token, jwtDecoded, isValidJWT } = getDecodedJWT(toolResult);
          if (isValidJWT) {
          pushFormattedSteps(formattedSteps, token, JSON.parse(JSON.stringify(jwtDecoded)));
          }
          }
          catch (err){
            console.error("Error while decoding JWT token: ", err);
          }
        }

      }
    }
    else {
      // Print thinking step
      console.log("🤔 THINKING STEP:", {
        text: getStepDescription(step, null),
        stepText: step.text
      });
      
      formattedSteps.push({
        step: 1,
        text: getStepDescription(step, null),
        tool: "thinking",
        input: {},
        result: null,
      });
    } 
  });
};

const checkAndUpdateAgentContextIfConnectionIsInitiated = (
  steps: AIStep[],
  agentContext: AgentContext
) => {
  let newToolsFound = false;
  let mcpServerConnected = false;
  let openApiSpecsAdded = false;

  steps.forEach((step: AIStep) => {
    // Process ALL tool calls in each step, not just the first one
    if (step.toolCalls && step.toolCalls.length > 0) {
      step.toolCalls.forEach((toolCall) => {
        const toolCallTyped = toolCall as unknown as ToolCall;

        if (toolCallTyped && toolCallTyped.toolName === "connect-mcp-server-tool") {
          const url = toolCallTyped.args["mcpServerUrl"];

          agentContext.dynamically_mounted_server = [{ url: url, headers: {} }];
          mcpServerConnected = true;
          newToolsFound = true;
        }

        if (toolCallTyped && toolCallTyped.toolName === "convert-openapi-spec-to-agent-tool") {
          const args = toolCallTyped.args as Record<string, unknown>;
          
          console.log("🛠️ Openapi Specs:", agentContext.openApiSpecs);

          console.log("🛠️ Adding new one");
          if (!agentContext.openApiSpecs) {
            agentContext.openApiSpecs = [];
          }
          agentContext.openApiSpecs.push({
            url: args["openApiSpecUrl"] as string
          });
          console.log("🛠️ Openapi Specs After:", agentContext.openApiSpecs);
          openApiSpecsAdded = true;
          newToolsFound = true;
        }
      });
    }
  });

  // Add system message only once after processing all calls
  if (mcpServerConnected || openApiSpecsAdded) {
    let systemMessage = "";
    
    if (mcpServerConnected && openApiSpecsAdded) {
      systemMessage = "You are now connected to the tools provided by the seller MCP server and OpenAPI specs as well, run tools as per input prompt to solve problems step by step. Remember never use connect-mcp-server-tool on a json url. When connect-mcp-server-tool tool is executed, stop the processing immediately.";
    } else if (mcpServerConnected) {
      systemMessage = "You are now connected to the tools provided by the seller MCP server as well, run tools as per input prompt to solve problems step by step. Remember never use connect-mcp-server-tool on a json url. When connect-mcp-server-tool tool is executed, stop the processing immediately.";
    } else if (openApiSpecsAdded) {
      systemMessage = "You are now connected to the tools provided by the OpenAPI spec as well, run tools as per input prompt to solve problems step by step. When connect-mcp-server-tool tool is executed, stop the processing immediately.";
    }

    agentContext.conversation_history.push({
      role: "system",
      content: systemMessage,
    });
  }

  return newToolsFound;
};
